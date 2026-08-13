/// Function selectors used by the launch detail page.
///
/// Contract selectors come from the compiled artifacts; `test/selectors.test.mjs` fails the build if
/// any of them stops matching. The three ERC-20 and ERC-721 entries are fixed by their standards
/// and are checked against their known values in the same test.
export const DETAIL_SELECTORS = {
  // DoomLaunchFactory
  "getLaunch(uint256)": "0x5930d3ce",
  // GmEscrow
  "status()": "0x200d2ed2",
  "completedCheckIns()": "0x60e0ed15",
  "requiredCheckIns()": "0xb371c14e",
  "releasedAmount()": "0x45d30a17",
  "committedAmount()": "0xb1688f63",
  "nextCheckInAt()": "0xe23c7430",
  "nextDeadline()": "0x20517984",
  // ERC-20 and ERC-721, fixed by the standards.
  "balanceOf(address)": "0x70a08231",
  "totalSupply()": "0x18160ddd",
  "ownerOf(uint256)": "0x6352211e",
};

/// Which artifact each contract selector must match, so the test can check them without guessing.
export const SELECTOR_SOURCES = {
  "getLaunch(uint256)": "DoomLaunchFactory",
  "status()": "GmEscrow",
  "completedCheckIns()": "GmEscrow",
  "requiredCheckIns()": "GmEscrow",
  "releasedAmount()": "GmEscrow",
  "committedAmount()": "GmEscrow",
  "nextCheckInAt()": "GmEscrow",
  "nextDeadline()": "GmEscrow",
};
