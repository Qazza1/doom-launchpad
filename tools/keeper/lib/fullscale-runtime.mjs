import { getAddress } from "viem";

const DECIMAL = /^(0|[1-9][0-9]*)$/;

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required when DOOM_FULLSCALE_V3_ENABLED=1`);
  return value;
}

export function buildFullScaleKeeperConfig(template, environment) {
  if (environment.DOOM_FULLSCALE_V3_ENABLED !== "1") return null;
  const deploymentBlock = required(environment, "DOOM_FULLSCALE_V3_FACTORY_DEPLOYMENT_BLOCK");
  if (!DECIMAL.test(deploymentBlock)) {
    throw new Error("DOOM_FULLSCALE_V3_FACTORY_DEPLOYMENT_BLOCK must be a decimal block number");
  }
  return {
    ...template,
    enabled: true,
    factoryDeploymentBlock: deploymentBlock,
    contracts: {
      ...template.contracts,
      factory: getAddress(required(environment, "DOOM_FULLSCALE_V3_FACTORY")),
      curveDeployer: getAddress(required(environment, "DOOM_FULLSCALE_V3_CURVE_DEPLOYER")),
      positionLocker: getAddress(required(environment, "DOOM_FULLSCALE_V3_POSITION_LOCKER")),
      graduationManager: getAddress(required(environment, "DOOM_FULLSCALE_V3_GRADUATION_MANAGER")),
    },
  };
}
