export * from "./helpers.js";
export * from "./errors.js";
export * from "./collateral-funding.js";
export { amountFor, assertMessageInput, buildQuote, PROBE_LAMPORTS, QuoteRateLimitedError, sizeCollateralPurchaseQuote, type BuildSwap,
  type EstimateCollateralRoute, type PreparedCollateralPurchase, type SizedCollateralRoute, type SwapQuery } from "./collateral-quote.js";
export * from "./confirm-signature.js";
export * from "./policy.js";
export type { CompositeArgs, CompositeComponent, CompositePlan, CreateOptions, FeedArgs, FeedPlan, FeedReceipt, PlannedStep, PoolChoice, Recipe, RecipeChoice, SignStep, StepEvent, StepKind, StepReview, StepToSign, Tariff } from "./facade.js";
import type * as Facade from "./facade.js";

// The facade loads the beta graph on first call, so a static import of a pure helper above stays light.
const facade = () => import("./facade.js");
/** The plan: steps, estimated SOL, prompts, recipe trade-offs and warnings. Builds and signs nothing. */
export const planFeed = async (args: Facade.FeedArgs) => (await facade()).prepareFeed(args);
/** @deprecated use planFeed */
export const prepareFeed = planFeed;
/** Builds each step just in time, hands its exact review to `sign`, sends, waits for `finalized`, then builds the next. */
export const createFeed = async (plan: Facade.FeedPlan, opts: Parameters<typeof Facade.createFeed>[1]) => (await facade()).createFeed(plan, opts);
/** The composite (index) plan over existing classic feeds: steps, estimated SOL with the activation fee, prompts. Builds and signs nothing. */
export const planComposite = async (args: Facade.CompositeArgs) => (await facade()).planComposite(args);
/** Builds step `index` of a classic plan just in time with its exact simulation (what `createFeed` hands to `sign`). */
export const prepareFeedStep = async (plan: Facade.FeedPlan, index: number) => (await facade()).prepareStep(plan, index);
/** @deprecated use prepareFeedStep */
export const prepareStep = prepareFeedStep;
/** Builds composite step `index` just in time with its exact simulation (what `createComposite` hands to `sign`). */
export const prepareCompositeStep = async (plan: Facade.CompositePlan, index: number) => (await facade()).prepareComposite(plan, index);
/** @deprecated use prepareCompositeStep */
export const prepareComposite = prepareCompositeStep;
/** Builds each composite step just in time, hands its exact review to `sign`, sends, waits for `finalized`. */
export const createComposite = async (plan: Facade.CompositePlan, opts: Facade.CreateOptions) => (await facade()).createComposite(plan, opts);
/** Jupiter's keyless `GET /swap/v2/build`: public default, rate-limited. */
export const jupiterSwapBuild = (opts?: { apiKey?: string }): import("./collateral-quote.js").BuildSwap => async (q) => (await facade()).jupiterSwapBuild(opts)(q);
/** Node/bot signer over `partiallySignMimirBetaTransactionV1`. */
export const keyPairSigner = async (keyPair: CryptoKeyPair) => (await facade()).keyPairSigner(keyPair);
