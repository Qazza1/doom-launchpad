/// Function selectors used by the discovery list.
///
/// Contract selectors come from the compiled artifacts and are checked by
/// `test/selectors.test.mjs`; the ERC-20 entries are fixed by the standard.
export const DISCOVERY_SELECTORS = {
  // DoomLaunchFactory
  "launchCount()": "0x27cca59f",
  "getLaunch(uint256)": "0x5930d3ce",
  // GmEscrow
  "status()": "0x200d2ed2",
  "completedCheckIns()": "0x60e0ed15",
  "requiredCheckIns()": "0xb371c14e",
  "nextCheckInAt()": "0xe23c7430",
  "nextDeadline()": "0x20517984",
  // ERC-20 metadata, fixed by the standard.
  "name()": "0x06fdde03",
  "symbol()": "0x95d89b41",
};

export const SELECTOR_SOURCES = {
  "launchCount()": "DoomLaunchFactory",
  "getLaunch(uint256)": "DoomLaunchFactory",
  "status()": "GmEscrow",
  "completedCheckIns()": "GmEscrow",
  "requiredCheckIns()": "GmEscrow",
  "nextCheckInAt()": "GmEscrow",
  "nextDeadline()": "GmEscrow",
};
