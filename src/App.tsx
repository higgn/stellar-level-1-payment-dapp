import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  LogOut,
  RefreshCw,
  Send,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import './App.css'
import {
  type BalanceResult,
  type PaymentResult,
  type RecentPayment,
  type WalletState,
  connectFreighter,
  explorerAccountUrl,
  explorerTxUrl,
  fetchRecentPayments,
  fetchXlmBalance,
  formatXlm,
  friendbotUrl,
  sendTestnetPayment,
  shortAddress,
} from './lib/stellar'

type Notice = {
  type: 'success' | 'error' | 'info'
  title: string
  message: string
}

const emptyBalance: BalanceResult = {
  xlm: '0',
  reserves: '0',
  sequence: '0',
}

const parseError = (error: unknown, fallback: string) => {
  if (error instanceof Error) {
    if (error.message.includes('op_no_destination')) {
      return 'Recipient account does not exist on Testnet. Fund that account first, then retry.'
    }

    if (error.message.includes('op_underfunded') || error.message.includes('tx_insufficient_balance')) {
      return 'The wallet does not have enough unlocked XLM for this payment and Stellar reserve.'
    }

    if (error.message.includes('Not Found')) {
      return 'This Testnet account is not funded yet. Use Friendbot, then refresh the balance.'
    }

    return error.message
  }

  return fallback
}

function App() {
  const [wallet, setWallet] = useState<WalletState | null>(null)
  const [balance, setBalance] = useState<BalanceResult>(emptyBalance)
  const [payments, setPayments] = useState<RecentPayment[]>([])
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('White Belt payment')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastPayment, setLastPayment] = useState<PaymentResult | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [copied, setCopied] = useState(false)

  const connectedAddress = wallet?.address ?? ''

  const canSend = useMemo(() => {
    return Boolean(connectedAddress && recipient.trim() && amount.trim() && !isSending)
  }, [amount, connectedAddress, isSending, recipient])

  const refreshAccount = async (address = connectedAddress) => {
    if (!address) {
      return
    }

    setIsRefreshing(true)

    try {
      const [nextBalance, nextPayments] = await Promise.all([
        fetchXlmBalance(address),
        fetchRecentPayments(address),
      ])

      setBalance(nextBalance)
      setPayments(nextPayments)
      setNotice(null)
    } catch (error) {
      setBalance(emptyBalance)
      setPayments([])
      setNotice({
        type: 'error',
        title: 'Balance unavailable',
        message: parseError(error, 'Could not fetch the Testnet balance.'),
      })
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleConnect = async () => {
    setIsConnecting(true)
    setNotice(null)

    try {
      const nextWallet = await connectFreighter()
      setWallet(nextWallet)
      setLastPayment(null)
      setNotice({
        type: nextWallet.isTestnet ? 'success' : 'error',
        title: nextWallet.isTestnet ? 'Wallet connected' : 'Switch Freighter to Testnet',
        message: nextWallet.isTestnet
          ? 'Freighter is connected and this app will use Stellar Testnet.'
          : 'Open Freighter settings and select Testnet before signing a transaction.',
      })
      await refreshAccount(nextWallet.address)
    } catch (error) {
      setNotice({
        type: 'error',
        title: 'Wallet connection failed',
        message: parseError(error, 'Could not connect Freighter.'),
      })
    } finally {
      setIsConnecting(false)
    }
  }

  const handleDisconnect = () => {
    setWallet(null)
    setBalance(emptyBalance)
    setPayments([])
    setLastPayment(null)
    setRecipient('')
    setAmount('')
    setNotice({
      type: 'info',
      title: 'Wallet disconnected',
      message: 'The app cleared the local wallet session. Freighter remains installed in your browser.',
    })
  }

  const copyAddress = async () => {
    if (!connectedAddress) {
      return
    }

    await navigator.clipboard.writeText(connectedAddress)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const handlePayment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!connectedAddress) {
      setNotice({
        type: 'error',
        title: 'Connect first',
        message: 'Connect Freighter before sending a Testnet payment.',
      })
      return
    }

    setIsSending(true)
    setLastPayment(null)
    setNotice({
      type: 'info',
      title: 'Waiting for signature',
      message: 'Review the payment in Freighter and approve it to submit on Testnet.',
    })

    try {
      const result = await sendTestnetPayment({
        from: connectedAddress,
        to: recipient,
        amount,
        memo,
      })

      setLastPayment(result)
      setNotice({
        type: 'success',
        title: 'Transaction confirmed',
        message: `Payment submitted to Stellar Testnet in ledger ${result.ledger}.`,
      })
      setRecipient('')
      setAmount('')
      await refreshAccount(connectedAddress)
    } catch (error) {
      setNotice({
        type: 'error',
        title: 'Transaction failed',
        message: parseError(error, 'The payment could not be submitted.'),
      })
    } finally {
      setIsSending(false)
    }
  }

  useEffect(() => {
    document.title = 'StellarPay Testnet'
  }, [])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">
            <ShieldCheck size={16} /> Stellar Testnet
          </div>
          <h1>StellarPay Testnet</h1>
          <p className="lead">
            Connect Freighter, verify your XLM balance, and send a real payment on Stellar Testnet.
          </p>
        </div>

        <div className="network-pill" aria-label="Active network">
          <span className="pulse" /> Testnet only
        </div>
      </header>

      {notice && (
        <section className={`notice ${notice.type}`} role="status">
          {notice.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <div>
            <strong>{notice.title}</strong>
            <p>{notice.message}</p>
          </div>
        </section>
      )}

      <section className="dashboard-grid">
        <article className="panel wallet-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Step 1</span>
              <h2>Wallet</h2>
            </div>
            <Wallet size={24} />
          </div>

          {!wallet ? (
            <div className="empty-state">
              <p>Use Freighter on Testnet to unlock balance and payment actions.</p>
              <button className="primary-button" onClick={handleConnect} disabled={isConnecting}>
                {isConnecting ? <Loader2 className="spin" size={18} /> : <Wallet size={18} />}
                {isConnecting ? 'Connecting...' : 'Connect Freighter'}
              </button>
              <a className="text-link" href="https://freighter.app/" target="_blank" rel="noreferrer">
                Install Freighter <ExternalLink size={14} />
              </a>
            </div>
          ) : (
            <div className="wallet-card">
              <div className="status-row">
                <span className="connected-dot" /> Connected
                <button className="ghost-button" onClick={handleDisconnect}>
                  <LogOut size={16} /> Disconnect
                </button>
              </div>

              <label>Public key</label>
              <div className="address-box">
                <code>{wallet.address}</code>
                <button onClick={copyAddress} aria-label="Copy wallet address">
                  <Copy size={16} /> {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <div className="wallet-links">
                <a href={explorerAccountUrl(wallet.address)} target="_blank" rel="noreferrer">
                  Stellar Expert <ExternalLink size={14} />
                </a>
                <a href={friendbotUrl(wallet.address)} target="_blank" rel="noreferrer">
                  Fund with Friendbot <ExternalLink size={14} />
                </a>
              </div>
            </div>
          )}
        </article>

        <article className="panel balance-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Step 2</span>
              <h2>XLM Balance</h2>
            </div>
            <button className="icon-button" onClick={() => refreshAccount()} disabled={!wallet || isRefreshing}>
              <RefreshCw className={isRefreshing ? 'spin' : ''} size={18} />
            </button>
          </div>

          <div className="balance-display">
            <span>Available balance</span>
            <strong>{formatXlm(balance.xlm)}</strong>
            <em>XLM</em>
          </div>

          <dl className="balance-meta">
            <div>
              <dt>Network reserve entries</dt>
              <dd>{balance.reserves}</dd>
            </div>
            <div>
              <dt>Sequence</dt>
              <dd>{balance.sequence === '0' ? 'Not loaded' : balance.sequence}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="dashboard-grid wide">
        <article className="panel payment-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Step 3</span>
              <h2>Send XLM</h2>
            </div>
            <Send size={24} />
          </div>

          <form className="payment-form" onSubmit={handlePayment}>
            <label>
              Recipient address
              <input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="G..."
                disabled={!wallet || isSending}
                autoComplete="off"
              />
            </label>

            <label>
              Amount in XLM
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="1.0000000"
                disabled={!wallet || isSending}
                type="number"
                min="0.0000001"
                step="0.0000001"
              />
            </label>

            <label>
              Memo
              <input
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="Optional, max 28 chars"
                maxLength={28}
                disabled={!wallet || isSending}
              />
            </label>

            <button className="primary-button" disabled={!canSend} type="submit">
              {isSending ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
              {isSending ? 'Submitting...' : 'Send Testnet XLM'}
            </button>
          </form>

          {lastPayment && (
            <div className="tx-result">
              <CheckCircle2 size={22} />
              <div>
                <strong>Successful testnet transaction</strong>
                <code>{lastPayment.hash}</code>
                <a href={explorerTxUrl(lastPayment.hash)} target="_blank" rel="noreferrer">
                  View transaction <ExternalLink size={14} />
                </a>
              </div>
            </div>
          )}
        </article>

        <article className="panel history-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Step 4</span>
              <h2>Recent Payments</h2>
            </div>
          </div>

          {payments.length === 0 ? (
            <div className="history-empty">
              {wallet ? 'No recent payment operations found yet.' : 'Connect Freighter to load payment history.'}
            </div>
          ) : (
            <div className="history-list">
              {payments.map((payment) => {
                const outgoing = payment.from === connectedAddress

                return (
                  <a key={payment.id} href={explorerTxUrl(payment.hash)} target="_blank" rel="noreferrer">
                    <span className={outgoing ? 'sent' : 'received'}>{outgoing ? 'Sent' : 'Received'}</span>
                    <strong>
                      {outgoing ? '-' : '+'}{formatXlm(payment.amount)} {payment.asset}
                    </strong>
                    <small>
                      {shortAddress(payment.from)} to {shortAddress(payment.to)}
                    </small>
                  </a>
                )
              })}
            </div>
          )}
        </article>
      </section>

      <section className="checklist-panel" aria-label="Submission requirement coverage">
        <h2>Submission Coverage</h2>
        <div className="coverage-grid">
          {[
            'Freighter wallet setup',
            'Stellar Testnet only',
            'Connect and disconnect',
            'XLM balance fetch',
            'XLM payment transaction',
            'Success and failure feedback',
            'Transaction hash display',
            'README and screenshot checklist',
          ].map((item) => (
            <div key={item}>
              <CheckCircle2 size={17} /> {item}
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
