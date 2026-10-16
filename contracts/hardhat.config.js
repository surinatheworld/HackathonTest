require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
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
};
