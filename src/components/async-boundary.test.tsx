import {
	QueryClient,
	QueryClientProvider,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { redirect } from "next/navigation";
import { Component, use } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AsyncBoundary } from "~/components/async-boundary";
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
	it("shows the skeleton and a Loading status while pending", async () => {
		await renderBoundary(<Suspends promise={deferred<string>().promise} />);

		expect(screen.getByText("Skeleton")).toBeInTheDocument();
		expect(screen.getByRole("status")).toHaveTextContent("Loading cash flow");
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
		// The fade class sits on the content's wrapper.
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
