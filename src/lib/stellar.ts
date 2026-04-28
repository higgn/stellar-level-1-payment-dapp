import {
  Asset,
  BASE_FEE,
  Horizon,
  Memo,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import {
  getNetworkDetails,
  isConnected,
  requestAccess,
  signTransaction,
} from '@stellar/freighter-api'

export const TESTNET_PASSPHRASE = Networks.TESTNET
export const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org'
export const FRIEND_BOT_URL = 'https://friendbot.stellar.org'

const server = new Horizon.Server(HORIZON_TESTNET_URL)

export type WalletState = {
  address: string
  walletNetwork: string
  walletNetworkPassphrase: string
  isTestnet: boolean
}

export type BalanceResult = {
  xlm: string
  reserves: string
  sequence: string
}

export type PaymentResult = {
  hash: string
  ledger: number
  successful: boolean
}

export type RecentPayment = {
  id: string
  hash: string
  amount: string
  asset: string
  from: string
  to: string
  createdAt: string
}

type FreighterError = {
  message?: string
}

const errorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as FreighterError).message || fallback)
  }

  return fallback
}

const assertValidPublicKey = (address: string, label = 'Stellar address') => {
  if (!StrKey.isValidEd25519PublicKey(address.trim())) {
    throw new Error(`${label} is not a valid Stellar public key.`)
  }
}

export const formatXlm = (amount: string | number) => {
  const parsed = typeof amount === 'string' ? Number(amount) : amount

  if (!Number.isFinite(parsed)) {
    return '0.0000000'
  }

  return parsed.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  })
}

export const shortAddress = (address: string, start = 6, end = 6) => {
  if (!address || address.length <= start + end) {
    return address
  }

  return `${address.slice(0, start)}...${address.slice(-end)}`
}

export const explorerAccountUrl = (address: string) =>
  `https://stellar.expert/explorer/testnet/account/${address}`

export const explorerTxUrl = (hash: string) =>
  `https://stellar.expert/explorer/testnet/tx/${hash}`

export const friendbotUrl = (address: string) =>
  `${FRIEND_BOT_URL}/?addr=${encodeURIComponent(address)}`

export async function connectFreighter(): Promise<WalletState> {
  const connection = await isConnected()

  if (connection.error) {
    throw new Error(errorMessage(connection.error, 'Unable to check Freighter.'))
  }

  if (!connection.isConnected) {
    throw new Error('Freighter is not installed or not available in this browser.')
  }

  const access = await requestAccess()

  if (access.error) {
    throw new Error(errorMessage(access.error, 'Freighter rejected the connection request.'))
  }

  if (!access.address) {
    throw new Error('Freighter did not return a wallet address.')
  }

  assertValidPublicKey(access.address, 'Connected wallet')

  const networkDetails = await getNetworkDetails()
  const walletNetwork = networkDetails.error ? '' : networkDetails.network
  const walletNetworkPassphrase = networkDetails.error
    ? ''
    : networkDetails.networkPassphrase

  return {
    address: access.address,
    walletNetwork,
    walletNetworkPassphrase,
    isTestnet: walletNetworkPassphrase === TESTNET_PASSPHRASE,
  }
}

export async function fetchXlmBalance(address: string): Promise<BalanceResult> {
  assertValidPublicKey(address, 'Wallet address')

  const account = await server.loadAccount(address)
  const nativeBalance = account.balances.find(
    (balance) => balance.asset_type === 'native',
  )

  return {
    xlm: nativeBalance && 'balance' in nativeBalance ? nativeBalance.balance : '0',
    reserves: account.subentry_count.toString(),
    sequence: account.sequence,
  }
}

export async function sendTestnetPayment({
  from,
  to,
  amount,
  memo,
}: {
  from: string
  to: string
  amount: string
  memo?: string
}): Promise<PaymentResult> {
  assertValidPublicKey(from, 'Sender address')
  assertValidPublicKey(to, 'Recipient address')

  const normalizedAmount = Number(amount)

  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error('Amount must be greater than 0 XLM.')
  }

  if (normalizedAmount < 0.0000001) {
    throw new Error('Amount must be at least 0.0000001 XLM.')
  }

  const sourceAccount = await server.loadAccount(from)
  const builder = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_PASSPHRASE,
  }).addOperation(
    Operation.payment({
      destination: to.trim(),
      asset: Asset.native(),
      amount: normalizedAmount.toFixed(7),
    }),
  )

  const cleanMemo = memo?.trim()

  if (cleanMemo) {
    builder.addMemo(Memo.text(cleanMemo.slice(0, 28)))
  }

  const transaction = builder.setTimeout(120).build()
  const signed = await signTransaction(transaction.toXDR(), {
    networkPassphrase: TESTNET_PASSPHRASE,
    address: from,
  })

  if (signed.error) {
    throw new Error(errorMessage(signed.error, 'Freighter could not sign the transaction.'))
  }

  if (!signed.signedTxXdr) {
    throw new Error('Freighter returned an empty signed transaction.')
  }

  const signedTransaction = TransactionBuilder.fromXDR(
    signed.signedTxXdr,
    TESTNET_PASSPHRASE,
  )
  const result = await server.submitTransaction(signedTransaction)

  return {
    hash: result.hash,
    ledger: result.ledger,
    successful: result.successful,
  }
}

export async function fetchRecentPayments(address: string): Promise<RecentPayment[]> {
  assertValidPublicKey(address, 'Wallet address')

  const response = await server
    .payments()
    .forAccount(address)
    .order('desc')
    .limit(8)
    .call()

  return response.records
    .filter((record) => record.type === 'payment')
    .map((record) => {
      const payment = record as Horizon.HorizonApi.PaymentOperationResponse

      return {
        id: payment.id,
        hash: payment.transaction_hash,
        amount: payment.amount,
        asset: payment.asset_type === 'native' ? 'XLM' : payment.asset_code || 'ASSET',
        from: payment.from,
        to: payment.to,
        createdAt: payment.created_at,
      }
    })
}
