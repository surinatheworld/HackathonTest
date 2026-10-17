// Privy login (email / Google) with an embedded wallet on Fuji. Loaded on demand by chain.js, straight from
// esm.sh, so the site still needs no build step. Exposes connect() → an EIP-1193 provider of the embedded
// wallet; chain.js signs the same EIP-712 ForwardRequests with it, and the fee manager still pays the gas.
import React from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import { PrivyProvider, useCreateWallet, useExportWallet, useLogin, usePrivy, useWallets } from "https://esm.sh/@privy-io/react-auth@3.45.0?deps=react@18.3.1,react-dom@18.3.1";

const cfg = window.FARM_CONFIG;
const c = cfg.cchain;
const fuji = {
  id: c.chainId,
  name: c.name,
  network: "avalanche-fuji",
  nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: [c.rpc] }, public: { http: [c.rpc] } },
  blockExplorers: { default: { name: "Snowtrace", url: c.explorer } },
  testnet: true,
};

const state = { privy: null, login: null, loginError: null, wallets: [], walletsReady: false, waiters: [] };
const settle = () => {
  const s = state;
  s.waiters = s.waiters.filter((w) => !w(s));
};

function Bridge() {
  const privy = usePrivy();
  const { wallets, ready } = useWallets();
  const { createWallet } = useCreateWallet();
  const { exportWallet } = useExportWallet();
  const { login } = useLogin({
    onComplete: settle,
    // Closing the modal lands here too, so connect() can give up instead of waiting.
    onError: (e) => {
      state.loginError = e || "exited_auth_flow";
      settle();
    },
  });
  state.privy = privy;
  state.login = login;
  state.createWallet = createWallet;
  state.exportWallet = exportWallet;
  state.wallets = wallets;
  state.walletsReady = ready;
  React.useEffect(settle);
  return null;
}

const host = document.createElement("div");
host.id = "privy-root";
document.body.appendChild(host);
createRoot(host).render(
  React.createElement(
    PrivyProvider,
    {
      appId: cfg.privyAppId,
      config: {
        loginMethods: ["email", "google"],
        appearance: { theme: "light", accentColor: "#3f8f3a", landingHeader: "Vào Nông Trại DeFi", loginMessage: "Đăng nhập bằng email hoặc Google. Ví được tạo sẵn, không cần AVAX." },
        // Wallet screens stay on: the key export runs inside one, and the dashboard enforces them for signing.
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: fuji,
        supportedChains: [fuji],
      },
    },
    React.createElement(Bridge)
  )
);

/** Resolves once `test(state)` is true. */
const until = (test, ms = 120_000) =>
  new Promise((resolve, reject) => {
    if (test(state)) return resolve(state);
    const timer = setTimeout(() => reject(new Error("Privy chưa sẵn sàng. Kiểm tra mạng rồi thử lại.")), ms);
    state.waiters.push((s) => (test(s) ? (clearTimeout(timer), resolve(s), true) : false));
  });

const isPrivy = (t) => typeof t === "string" && t.startsWith("privy");
const lower = (a) => String(a || "").toLowerCase();
/** The user's embedded Ethereum wallets as recorded on their Privy account, oldest first. */
const linkedWallets = (s) =>
  (s.privy?.user?.linkedAccounts || [])
    .filter((a) => a.type === "wallet" && (isPrivy(a.walletClientType) || a.connectorType === "embedded") && (a.chainType || "ethereum") === "ethereum")
    .sort((a, b) => new Date(a.firstVerifiedAt || a.verifiedAt || 0) - new Date(b.firstVerifiedAt || b.verifiedAt || 0));
/** Always the same wallet for the same account: the oldest embedded wallet, once its provider has loaded. */
const embedded = (s) => {
  const first = linkedWallets(s)[0];
  if (first) return s.wallets.find((w) => lower(w.address) === lower(first.address)) || null;
  return s.wallets.find((w) => isPrivy(w.walletClientType)) || null;
};

export async function connect() {
  await until((s) => s.privy?.ready);
  if (!state.privy.authenticated) {
    state.loginError = null;
    state.login();
    // No short timeout while the player types the email code; closing the modal cancels.
    await until((s) => s.privy.authenticated || s.loginError, 15 * 60_000);
    if (!state.privy.authenticated) throw new Error("Bạn đã đóng cửa sổ đăng nhập Privy.");
  }
  await until((s) => s.walletsReady);
  // Privy creates the wallet on login (createOnLogin) and its provider loads a moment later. Creating one here
  // as well made a second wallet, so only do it when the account still has none after Privy had time to act.
  if (!linkedWallets(state).length) {
    await until((s) => linkedWallets(s).length > 0, 8_000).catch(() => {});
    if (!linkedWallets(state).length) await state.createWallet();
  }
  await until((s) => embedded(s), 60_000);
  const wallet = embedded(state);
  await wallet.switchChain(c.chainId).catch(() => {});
  return { provider: await wallet.getEthereumProvider(), address: wallet.address, user: state.privy.user };
}

/** Privy shows the private key in its own secure window; the game never sees it. */
export async function exportKey() {
  const wallet = embedded(state);
  if (!wallet) throw new Error("Chưa có ví Privy.");
  await state.exportWallet({ address: wallet.address });
}

export async function logout() {
  if (state.privy?.authenticated) await state.privy.logout();
}
