import {
	QueryClient,
	QueryClientProvider,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TRPCClientError } from "@trpc/client";
import { redirect } from "next/navigation";
import { Component, use, useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AsyncBoundary } from "~/components/async-boundary";
import { PageSkeleton } from "~/components/page-skeleton";
import { createAppRouter } from "~/test/app-router";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function Suspends({ promise }: { promise: Promise<string> }) {
	return <p>{use(promise)}</p>;
}

// React 19 only retries a suspended render whose act() was awaited.
async function renderBoundary(children: React.ReactNode) {
	const { router, AppRouter } = createAppRouter();
	const view = await act(async () =>
		render(
			<AsyncBoundary label="cash flow" skeleton={<p>Skeleton</p>}>
				{children}
			</AsyncBoundary>,
			{ wrapper: AppRouter },
		),
	);
	return { ...view, router };
}

describe("AsyncBoundary", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("shows the skeleton and a Loading status while pending", async () => {
		await renderBoundary(<Suspends promise={deferred<string>().promise} />);

		expect(screen.getByText("Skeleton")).toBeInTheDocument();
		expect(screen.getByRole("status")).toHaveTextContent("Loading cash flow");
		expect(screen.getByRole("status").closest("[aria-busy]")).toBeNull();
	});

	it("shows the content once resolved", async () => {
		const { promise, resolve } = deferred<string>();
		await renderBoundary(<Suspends promise={promise} />);

		await act(async () => resolve("Chart"));

		expect(screen.getByText("Chart")).toBeInTheDocument();
		expect(screen.queryByText("Skeleton")).not.toBeInTheDocument();
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});

	describe("fade", () => {
		const wrapperOf = (text: string) => screen.getByText(text).parentElement;

		it("fades the content in after the skeleton showed", async () => {
			const { promise, resolve } = deferred<string>();
			await renderBoundary(<Suspends promise={promise} />);

			await act(async () => resolve("Chart"));

			expect(wrapperOf("Chart")).toHaveClass("fade-in");
		});

		it("doesn't fade content that mounts without suspending", async () => {
			await renderBoundary(<p>Chart</p>);

			expect(wrapperOf("Chart")).not.toHaveClass("fade-in");
		});

		it("fades a cached region once it re-suspends", async () => {
			const { router, rerender } = await renderBoundary(<p>Chart</p>);
			const { promise, resolve } = deferred<string>();

			await act(async () =>
				rerender(
					<AsyncBoundary label="cash flow" skeleton={<p>Skeleton</p>}>
						<Suspends promise={promise} />
					</AsyncBoundary>,
				),
			);
			expect(screen.getByText("Skeleton")).toBeInTheDocument();
			await act(async () => resolve("Month chart"));

			expect(wrapperOf("Month chart")).toHaveClass("fade-in");
			expect(router.refresh).not.toHaveBeenCalled();
		});

		it("never fades with fade={false}", async () => {
			const { promise, resolve } = deferred<string>();
			const { AppRouter } = createAppRouter();
			await act(async () =>
				render(
					<AsyncBoundary
						fade={false}
						label="expenses"
						skeleton={<p>Skeleton</p>}
					>
						<Suspends promise={promise} />
					</AsyncBoundary>,
					{ wrapper: AppRouter },
				),
			);

			await act(async () => resolve("Expenses"));

			expect(wrapperOf("Expenses")).not.toHaveClass("fade-in");
		});

		it("keeps server-streamed content's fade through hydration, without a warning", async () => {
			const errors = vi.spyOn(console, "error").mockImplementation(() => {});
			const { AppRouter } = createAppRouter();
			const ui = (
				<AppRouter>
					<AsyncBoundary label="cash flow" skeleton={<p>Skeleton</p>}>
						<p>Chart</p>
					</AsyncBoundary>
				</AppRouter>
			);
			const container = document.createElement("div");
			container.innerHTML = renderToString(ui);
			document.body.appendChild(container);

			await act(async () => render(ui, { container, hydrate: true }));

			expect(wrapperOf("Chart")).toHaveClass("fade-in");
			expect(errors).not.toHaveBeenCalled();
		});
	});

	describe("error", () => {
		// React also logs caught errors; silence the noise, keep the calls.
		const silenceErrors = () =>
			vi.spyOn(console, "error").mockImplementation(() => {});

		function Throws({ error }: { error: Error }): never {
			throw error;
		}

		it("shows a Couldn't load card and logs the error", async () => {
			const errors = silenceErrors();
			const error = new Error("boom");
			await renderBoundary(<Throws error={error} />);

			expect(screen.getByRole("alert")).toHaveTextContent(
				"Couldn't load cash flow",
			);
			expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
			expect(errors).toHaveBeenCalledWith(error);
		});

		it("puts the card in a page skeleton's body, under its header", async () => {
			silenceErrors();
			const user = userEvent.setup();
			const { AppRouter } = createAppRouter();
			let fail = true;
			function Flaky() {
				if (fail) throw new Error("offline");
				return <p>Pay received</p>;
			}
			await act(async () =>
				render(
					<AsyncBoundary
						label="income"
						skeleton={
							<article aria-label="Income page">
								<PageSkeleton description="Money in." title="Income" />
							</article>
						}
					>
						<Flaky />
					</AsyncBoundary>,
					{ wrapper: AppRouter },
				),
			);

			const page = screen.getByRole("article", { name: "Income page" });
			expect(page).toContainElement(screen.getByRole("alert"));
			expect(
				screen.getByRole("heading", { level: 1, name: "Income" }),
			).toBeInTheDocument();

			fail = false;
			await user.click(screen.getByRole("button", { name: "Try again" }));

			expect(await screen.findByText("Pay received")).toBeInTheDocument();
			expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		});

		it("renders nothing for a skeleton={null} gate, but still logs", async () => {
			const errors = silenceErrors();
			const error = new Error("boom");
			const { AppRouter } = createAppRouter();
			const { container } = await act(async () =>
				render(
					<AsyncBoundary label="session" skeleton={null}>
						<Throws error={error} />
					</AsyncBoundary>,
					{ wrapper: AppRouter },
				),
			);

			expect(container).toBeEmptyDOMElement();
			expect(errors).toHaveBeenCalledWith(error);
		});

		it("keeps the skeleton, not the card, for a stale session", async () => {
			silenceErrors();
			const error = TRPCClientError.from({
				error: {
					code: -32001,
					message: "UNAUTHORIZED",
					data: { code: "UNAUTHORIZED" },
				},
			});
			await renderBoundary(<Throws error={error} />);

			expect(screen.getByText("Skeleton")).toBeInTheDocument();
			expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		});

		it("Try again refetches the failed query and refreshes the router", async () => {
			silenceErrors();
			const user = userEvent.setup();
			const queryClient = new QueryClient({
				defaultOptions: { queries: { retry: false } },
			});
			const queryFn = vi
				.fn<() => Promise<string>>()
				.mockRejectedValueOnce(new Error("offline"))
				.mockResolvedValue("Chart");
			function Query() {
				const { data } = useSuspenseQuery({ queryKey: ["chart"], queryFn });
				return <p>{data}</p>;
			}
			const { router } = await renderBoundary(
				<QueryClientProvider client={queryClient}>
					<Query />
				</QueryClientProvider>,
			);
			expect(await screen.findByRole("alert")).toBeInTheDocument();

			await user.click(screen.getByRole("button", { name: "Try again" }));

			expect(await screen.findByText("Chart")).toBeInTheDocument();
			expect(router.refresh).toHaveBeenCalledOnce();
			expect(queryFn).toHaveBeenCalledTimes(2);
		});

		it("a new resetKey clears the card without refreshing the router", async () => {
			silenceErrors();
			function Rows({ filter }: { filter: string }) {
				if (filter === "broken") throw new Error("offline");
				return <p>Rows for {filter}</p>;
			}
			const ui = (filter: string) => (
				<AsyncBoundary
					label="transactions"
					resetKey={filter}
					skeleton={<p>Skeleton</p>}
				>
					<Rows filter={filter} />
				</AsyncBoundary>
			);
			const { router, AppRouter } = createAppRouter();
			const { rerender } = await act(async () =>
				render(ui("broken"), { wrapper: AppRouter }),
			);
			await act(async () => rerender(ui("broken")));
			expect(screen.getByRole("alert")).toBeInTheDocument();

			await act(async () => rerender(ui("groceries")));

			expect(await screen.findByText("Rows for groceries")).toBeInTheDocument();
			expect(screen.queryByRole("alert")).not.toBeInTheDocument();
			expect(router.refresh).not.toHaveBeenCalled();
		});

		it("Try again moves focus to the recovered content", async () => {
			silenceErrors();
			const user = userEvent.setup();
			let fail = true;
			function Flaky() {
				if (fail) throw new Error("offline");
				return <p>Chart</p>;
			}
			await renderBoundary(<Flaky />);
			fail = false;

			await user.click(screen.getByRole("button", { name: "Try again" }));

			// The Try again button unmounts with the card; focus must not fall to <body>.
			const chart = await screen.findByText("Chart");
			expect(document.activeElement).not.toBe(document.body);
			expect(document.activeElement).toContainElement(chart);
		});

		it("Try again leaves focus alone if the user moved on while it loaded", async () => {
			silenceErrors();
			const user = userEvent.setup();
			const { AppRouter } = createAppRouter();
			const { promise, resolve } = deferred<string>();
			let fail = true;
			function Flaky() {
				if (fail) throw new Error("offline");
				return <Suspends promise={promise} />;
			}
			await act(async () =>
				render(
					<>
						<input aria-label="Note" />
						<AsyncBoundary label="cash flow" skeleton={<p>Skeleton</p>}>
							<Flaky />
						</AsyncBoundary>
					</>,
					{ wrapper: AppRouter },
				),
			);
			fail = false;

			await act(async () =>
				user.click(screen.getByRole("button", { name: "Try again" })),
			);
			expect(screen.queryByRole("alert")).not.toBeInTheDocument();
			await user.click(screen.getByRole("textbox", { name: "Note" }));
			await act(async () => resolve("Chart"));

			expect(screen.getByText("Chart")).toBeInTheDocument();
			expect(screen.getByRole("textbox", { name: "Note" })).toHaveFocus();
		});

		it("a failed Try again moves focus to the new Try again", async () => {
			silenceErrors();
			const user = userEvent.setup();
			function AlwaysFails(): never {
				throw new Error("offline");
			}
			await renderBoundary(<AlwaysFails />);

			await user.click(screen.getByRole("button", { name: "Try again" }));

			const tryAgain = await screen.findByRole("button", { name: "Try again" });
			expect(tryAgain).toHaveFocus();
			expect(tryAgain).not.toHaveAttribute("aria-busy");
		});

		it("Try again shows it's working while the refresh is pending", async () => {
			silenceErrors();
			const user = userEvent.setup();
			const { router, AppRouter } = createAppRouter();
			const { promise, resolve } = deferred<string>();
			// A real refresh suspends the page above, so the card stays up until the server answers.
			let startRefresh = () => {};
			function Page({ children }: { children: React.ReactNode }) {
				const [refreshing, setRefreshing] = useState(false);
				startRefresh = () => setRefreshing(true);
				if (refreshing) use(promise);
				return children;
			}
			router.refresh.mockImplementation(() => startRefresh());
			let fail = true;
			function Flaky() {
				if (fail) throw new Error("offline");
				return <p>Chart</p>;
			}
			await act(async () =>
				render(
					<Page>
						<AsyncBoundary label="cash flow" skeleton={<p>Skeleton</p>}>
							<Flaky />
						</AsyncBoundary>
					</Page>,
					{ wrapper: AppRouter },
				),
			);
			fail = false;

			await act(async () =>
				user.click(screen.getByRole("button", { name: "Try again" })),
			);

			expect(screen.getByRole("button", { name: "Try again" })).toHaveAttribute(
				"aria-busy",
				"true",
			);
			await act(async () => resolve("Chart"));
			expect(screen.getByText("Chart")).toBeInTheDocument();
		});

		it("lets redirect() through to the boundary above", async () => {
			silenceErrors();
			function Redirects(): never {
				redirect("/sign-in");
			}
			const { AppRouter } = createAppRouter();
			await act(async () =>
				render(
					<Outer>
						<AsyncBoundary label="member" skeleton={<p>Skeleton</p>}>
							<Redirects />
						</AsyncBoundary>
					</Outer>,
					{ wrapper: AppRouter },
				),
			);

			expect(
				screen.getByText(/^NEXT_REDIRECT;.*\/sign-in/),
			).toBeInTheDocument();
			expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		});
	});
});

// Stands in for Next's own boundary above a section: shows what reached it.
class Outer extends Component<
	{ children: React.ReactNode },
	{ digest: string | null }
> {
	state = { digest: null };

	static getDerivedStateFromError(error: { digest?: string }) {
		return { digest: error.digest ?? "no digest" };
	}

	render() {
		return this.state.digest === null ? (
			this.props.children
		) : (
			<p>{this.state.digest}</p>
		);
	}
}
