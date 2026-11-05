import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AnswerInput, DuplicateApply } from "~/domain/transactions";
import { Answer, DuplicateApplyStatus } from "~/lib/constants";
import { ConflictError } from "~/server/errors/domain-errors";
import type {
	LogAttributes,
	Logger,
} from "~/server/observability/logging/logger";
import { failedQuery, recorder, throwing, unstaged } from "~/test/fakes";
import {
	applyActiveSince,
	type DuplicateApplyRepository,
	DuplicateApplyService,
} from "./duplicate-apply.service";

type LogEntry = { level: string; msg: string; attrs: LogAttributes };

const NOW = new Date("2026-09-29T00:00:00.000Z");
const minutesAgo = (minutes: number) =>
	new Date(NOW.getTime() - minutes * 60_000);

const APPLY: DuplicateApply = {
	id: 7,
	createdAt: minutesAgo(20),
	error: null,
	finishedAt: null,
	gone: 0,
	applied: 0,
	status: DuplicateApplyStatus.Running,
	taken: 0,
	total: 2,
	updatedAt: minutesAgo(1),
};

const keepMine = (id: number): AnswerInput => ({ id, answer: Answer.KeepMine });
const useBank = (id: number): AnswerInput => ({ id, answer: Answer.UseBank });

function serviceWith(staged: Partial<DuplicateApplyRepository>) {
	const repository: DuplicateApplyRepository = {
		startApply: unstaged,
		takeApplyBatch: unstaged,
		applyAnswer: unstaged,
		releaseAnswer: unstaged,
		finishApply: unstaged,
		failApply: unstaged,
		latestApply: unstaged,
		...staged,
	};
	const logs: LogEntry[] = [];
	const logger: Logger = {
		debug: (msg, attrs = {}) => logs.push({ level: "debug", msg, attrs }),
		info: (msg, attrs = {}) => logs.push({ level: "info", msg, attrs }),
		warn: (msg, attrs = {}) => logs.push({ level: "warn", msg, attrs }),
		error: (msg, attrs = {}) => logs.push({ level: "error", msg, attrs }),
		with: () => logger,
	};

	return { service: new DuplicateApplyService({ repository, logger }), logs };
}

// Pending reviews on household rows, so a Use bank's takes every other review
// on its row, as the real resolve does.
function reviewsOn(rows: Record<number, number>) {
	const pending = new Map(Object.entries(rows).map(([id, t]) => [+id, t]));
	const applied: number[] = [];

	const applyAnswer: DuplicateApplyRepository["applyAnswer"] = async (
		_,
		{ id, answer },
	) => {
		const transactionId = pending.get(id);

		if (transactionId === undefined) return false;

		pending.delete(id);
		applied.push(id);

		if (answer === Answer.UseBank) {
			for (const [other, t] of pending) {
				if (t === transactionId) pending.delete(other);
			}
		}

		return true;
	};

	return { applyAnswer, applied };
}

beforeAll(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});

afterAll(() => {
	vi.useRealTimers();
});

describe("start", () => {
	it("fails an Apply idle 15 minutes before taking the slot", async () => {
		const started = { ...APPLY, active: true, pending: 2 };
		const startApply = recorder(started);
		const { service } = serviceWith({ startApply: startApply.method });
		const answers = [keepMine(1), useBank(2)];

		await expect(service.start({ answers })).resolves.toEqual(started);
		expect(startApply.calls).toEqual([[answers, minutesAgo(15)]]);
	});

	it("refuses a second Apply while one runs", async () => {
		const { service } = serviceWith({
			startApply: throwing(failedQuery("23505")),
		});

		const thrown = await service
			.start({ answers: [keepMine(1)] })
			.catch((error: unknown) => error);

		expect(thrown).toBeInstanceOf(ConflictError);
		expect(thrown).toMatchObject({ message: "An apply is already running." });
	});

	it("lets any other failure through", async () => {
		const error = failedQuery("23503");
		const { service } = serviceWith({ startApply: throwing(error) });

		await expect(service.start({ answers: [keepMine(1)] })).rejects.toBe(error);
	});
});

describe("applyBatch", () => {
	it("takes 50 at a time and counts each through its own write", async () => {
		const takeApplyBatch = recorder([keepMine(1), useBank(2)]);
		const applyAnswer = recorder(true);
		const { service } = serviceWith({
			takeApplyBatch: takeApplyBatch.method,
			applyAnswer: applyAnswer.method,
		});

		await expect(service.applyBatch(7)).resolves.toEqual({ more: false });
		expect(takeApplyBatch.calls).toEqual([[7, 50]]);
		expect(applyAnswer.calls).toEqual([
			[7, keepMine(1)],
			[7, useBank(2)],
		]);
	});

	it("leaves an Answer whose review is gone for finish to count", async () => {
		const releaseAnswer = recorder(true);
		const { service } = serviceWith({
			takeApplyBatch: async () => [keepMine(1)],
			applyAnswer: async () => false,
			releaseAnswer: releaseAnswer.method,
		});

		await service.applyBatch(7);

		expect(releaseAnswer.calls).toEqual([]);
	});

	it("releases a Use bank's whose bank row sits on another row", async () => {
		const releaseAnswer = recorder(true);
		const applied: number[] = [];
		const { service } = serviceWith({
			takeApplyBatch: async () => [useBank(2), keepMine(3)],
			applyAnswer: async (_, { id }) => {
				if (id === 2) throw failedQuery("23505");

				applied.push(id);

				return true;
			},
			releaseAnswer: releaseAnswer.method,
		});

		await service.applyBatch(7);

		expect(releaseAnswer.calls).toEqual([[7, 2]]);
		expect(applied).toEqual([3]);
	});

	it("stops the step on any other failure, so Inngest retries it", async () => {
		const error = new Error("connection reset");
		const { service } = serviceWith({
			takeApplyBatch: async () => [keepMine(1)],
			applyAnswer: throwing(error),
		});

		await expect(service.applyBatch(7)).rejects.toBe(error);
	});

	it.each([
		[50, true],
		[49, false],
	])("with %i Answers taken, more is %s", async (size, more) => {
		const batch = Array.from({ length: size }, (_, i) => keepMine(i + 1));
		const { service } = serviceWith({
			takeApplyBatch: async () => batch,
			applyAnswer: async () => true,
		});

		await expect(service.applyBatch(7)).resolves.toEqual({ more });
	});

	it("keeps a Keep mine that runs before a Use bank's on the same row", async () => {
		const reviews = reviewsOn({ 1: 100, 2: 100 });
		const releaseAnswer = recorder(true);
		const { service } = serviceWith({
			takeApplyBatch: async () => [keepMine(1), useBank(2)],
			applyAnswer: reviews.applyAnswer,
			releaseAnswer: releaseAnswer.method,
		});

		await service.applyBatch(7);

		expect(reviews.applied).toEqual([1, 2]);
		expect(releaseAnswer.calls).toEqual([]);
	});

	it("lets the lower id win when two Use bank's share a row", async () => {
		const reviews = reviewsOn({ 1: 100, 2: 100 });
		const { service } = serviceWith({
			takeApplyBatch: async () => [useBank(1), useBank(2)],
			applyAnswer: reviews.applyAnswer,
		});

		await service.applyBatch(7);

		expect(reviews.applied).toEqual([1]);
	});
});

describe("finish", () => {
	it("closes the Apply", async () => {
		const finishApply = recorder(undefined);
		const { service } = serviceWith({ finishApply: finishApply.method });

		await service.finish(7);

		expect(finishApply.calls).toEqual([[7]]);
	});
});

describe("fail", () => {
	it("fails the Apply and logs why", async () => {
		const failApply = recorder(true);
		const { service, logs } = serviceWith({ failApply: failApply.method });

		await service.fail(7, "boom");

		expect(failApply.calls).toEqual([[7, "boom"]]);
		expect(logs).toEqual([
			{
				level: "error",
				msg: "duplicate apply failed",
				attrs: { applyId: 7, message: "boom" },
			},
		]);
	});
});

describe("current", () => {
	it("is null before the first Apply", async () => {
		const { service } = serviceWith({ latestApply: async () => undefined });

		await expect(service.current()).resolves.toBeNull();
	});

	it.each([
		["running and moved 1 minute ago", {}, true],
		["running but idle 16 minutes", { updatedAt: minutesAgo(16) }, false],
		["done", { status: DuplicateApplyStatus.Done }, false],
	])("%s: active is %s", async (_, patch, active) => {
		const row = { ...APPLY, ...patch, pending: 2 };
		const { service } = serviceWith({ latestApply: async () => row });

		await expect(service.current()).resolves.toEqual({ ...row, active });
	});
});

describe("applyActiveSince", () => {
	it("is 15 minutes before now", () => {
		expect(applyActiveSince()).toEqual(minutesAgo(15));
	});
});
