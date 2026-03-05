import path from 'path';
import fs from 'fs';

export interface NetworkConfig {
  url: string;
  name?: string;
}

export interface AccountsConfig {
  count?: number;
}

export interface XrplUpConfig {
  networks: Record<string, NetworkConfig>;
  defaultNetwork: string;
  accounts?: AccountsConfig;
}

export const DEFAULT_CONFIG: XrplUpConfig = {
  networks: {
    testnet: {
      url: 'wss://s.altnet.rippletest.net:51233',
      name: 'XRPL Testnet',
    },
    devnet: {
      url: 'wss://s.devnet.rippletest.net:51233',
      name: 'XRPL Devnet',
    },
    mainnet: {
      url: 'wss://xrplcluster.com',
      name: 'XRPL Mainnet',
    },
  },
  defaultNetwork: 'testnet',
  accounts: {
    count: 10,
  },
};

function mergeConfig(
  defaults: XrplUpConfig,
  user: Partial<XrplUpConfig>
): XrplUpConfig {
  return {
    ...defaults,
    ...user,
    networks: {
      ...defaults.networks,
      ...(user.networks ?? {}),
    },
    accounts: {
      ...defaults.accounts,
      ...(user.accounts ?? {}),
    },
  };
}

export function loadConfig(): XrplUpConfig {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'xrpl-up.config.js'),
    path.join(cwd, 'xrpl-up.config.json'),
    path.join(cwd, '.xrpl-up.json'),
  ];

  for (const cfgPath of candidates) {
    if (!fs.existsSync(cfgPath)) continue;
    try {
      let userConfig: Partial<XrplUpConfig>;
      if (cfgPath.endsWith('.json')) {
        userConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      } else {
        const mod = require(cfgPath);
        userConfig = mod.default ?? mod;
      }
      return mergeConfig(DEFAULT_CONFIG, userConfig);
    } catch {
      // fall through
    }
  }

  return DEFAULT_CONFIG;
}

export function resolveNetwork(
  config: XrplUpConfig,
  networkName?: string
): { name: string; config: NetworkConfig } {
  const name = networkName ?? config.defaultNetwork;
  const netCfg = config.networks[name];
  if (!netCfg) {
    const available = Object.keys(config.networks).join(', ');
    throw new Error(`Network "${name}" not found. Available: ${available}`);
  }
  return { name, config: netCfg };
}

export function isMainnet(networkName: string, networkConfig: NetworkConfig): boolean {
  return (
    networkName === 'mainnet' ||
    networkConfig.url.includes('xrplcluster.com') ||
    networkConfig.url.includes('s1.ripple.com') ||
    networkConfig.url.includes('s2.ripple.com')
  );
}
