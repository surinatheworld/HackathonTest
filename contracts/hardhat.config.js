require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-verify");
require("dotenv").config();

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // "paris" avoids PUSH0 so the bytecode runs on any Subnet-EVM version.
      evmVersion: "paris",
    },
  },
  networks: {
    // FORK_FUJI=1 npm run test:fork  → runs test/fork/*.js against the live Fuji deployment.
    hardhat: process.env.FORK_FUJI
      ? {
          chainId: 43113,
          forking: { url: process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc" },
          // Hardhat only knows Ethereum's fork schedule; tell it Fuji blocks run Cancun rules.
          chains: { 43113: { hardforkHistory: { cancun: 0 } } },
        }
      : {},
    fuji: {
      url: process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc",
      chainId: 43113,
      accounts,
    },
    farml1: {
      url: process.env.L1_RPC_URL || "http://127.0.0.1:9650/ext/bc/farm/rpc",
      chainId: process.env.L1_CHAIN_ID ? Number(process.env.L1_CHAIN_ID) : undefined,
      accounts,
    },
  },
  // Snowtrace (testnet) runs on Routescan's Etherscan-compatible API; any non-empty key works.
  etherscan: {
    apiKey: { fuji: process.env.SNOWTRACE_API_KEY || "snowtrace" },
    customChains: [
      {
        network: "fuji",
        chainId: 43113,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan",
          browserURL: "https://testnet.snowtrace.io",
        },
      },
    ],
  },
  sourcify: { enabled: false },
};
