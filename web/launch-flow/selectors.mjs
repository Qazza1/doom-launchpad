/// Function selectors for the deployed factory, taken from the compiled artifact.
///
/// A browser cannot read `out/`, so they are inlined here rather than derived at run time.
/// `test/selectors.test.mjs` compares every one of them against the artifact and fails the build if
/// they diverge. This matters more than it looks: a wrong selector does not error, it reads a
/// different function and shows a confident, wrong number.
export const SELECTORS = {
  "launchesPaused()": "0x3bc340c2",
  "launchCount()": "0x27cca59f",
  "maxLaunches()": "0x03dce94e",
};
