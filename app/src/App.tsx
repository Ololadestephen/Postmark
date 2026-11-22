import { lazy, Suspense, useEffect } from "react";
import { fetchIndex } from "./chain/indexer";
import { routeLoaders, warmUp } from "./prefetch";
import { Routes, Route } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IndexerProvider } from "./chain/IndexerProvider";
import { ToastProvider } from "./components/Toasts";
import { GithubRateLimitToast } from "./components/GithubRateLimitToast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Shell } from "./components/Shell";
import Landing from "./pages/Landing";
import NotFound from "./pages/NotFound";

const Explore = lazy(routeLoaders["/explore"]);
const BountyDetail = lazy(routeLoaders["/bounty"]);
const Create = lazy(routeLoaders["/create"]);
const Me = lazy(routeLoaders["/me"]);
const Signer = lazy(routeLoaders["/signer"]);
const Start = lazy(routeLoaders["/start"]);
const VerifierJoin = lazy(routeLoaders["/verifiers/join"]);
const Review = lazy(() => import("./pages/Review"));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false } },
});

const B = ({ children }: { children: React.ReactNode }) => (
  <ErrorBoundary><Suspense fallback={null}>{children}</Suspense></ErrorBoundary>
);

export default function App() {
  useEffect(() => { warmUp(() => { void queryClient.prefetchQuery({ queryKey: ["index"], queryFn: fetchIndex, staleTime: 30_000 }); }); }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <GithubRateLimitToast />
        <IndexerProvider>
          <Shell>
            <Routes>
              <Route path="/" element={<B><Landing /></B>} />
              <Route path="/explore" element={<B><Explore /></B>} />
              <Route path="/bounty/:id" element={<B><BountyDetail /></B>} />
              <Route path="/bounty/:id/review" element={<B><Review /></B>} />
              <Route path="/create" element={<B><Create /></B>} />
              <Route path="/me" element={<B><Me /></B>} />
              <Route path="/start" element={<B><Start /></B>} />
              <Route path="/verifiers/join" element={<B><VerifierJoin /></B>} />
              <Route path="/signer" element={<B><Signer /></B>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Shell>
        </IndexerProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
