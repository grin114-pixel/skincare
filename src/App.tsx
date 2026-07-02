import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import { type Database, getSupabaseClient, isSupabaseConfigured } from './lib/supabase'
import { hashPin } from './lib/pin'

type RecordRow = Database['public']['Tables']['skincare_records']['Row']

type EditDraft = {
  record_date: string
  procedure_name: string
  dosage_memo: string
  hospital: string
  amount: string
  session_memo: string
  content: string
}

const AUTH_STORAGE_KEY = 'skincare.remembered-auth'
const PIN_HASH_STORAGE_KEY = 'skincare.pin-hash'
const DEFAULT_PIN = '1234'
const SETTINGS_ROW_ID = 'global'

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
}

function todayDateString(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatRecordDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()]
  const yyyy = String(year)
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${yyyy}. ${mm}. ${dd} (${weekday})`
}

function autosizeTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function KoreanDateInput({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  function openPicker() {
    const el = inputRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      try { el.showPicker() } catch { el.focus() }
    } else {
      el.focus()
    }
  }

  const display = value ? formatRecordDate(value) : '날짜 선택'

  return (
    <div className={`korean-date-wrap${className ? ` ${className}` : ''}`} onClick={openPicker}>
      <span className={`korean-date-display${!value ? ' korean-date-placeholder' : ''}`}>
        {display}
      </span>
      <span className="korean-date-icon"><CalendarIcon /></span>
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="korean-date-hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  )
}

function App() {
  /* ── Auth state ── */
  const [isCheckingRememberedAuth, setIsCheckingRememberedAuth] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [rememberDevice, setRememberDevice] = useState(false)
  const [pin, setPin] = useState('')
  const [authError, setAuthError] = useState('')
  const [isChangingPin, setIsChangingPin] = useState(false)
  const [currentPinInput, setCurrentPinInput] = useState('')
  const [newPinInput, setNewPinInput] = useState('')
  const [pinChangeError, setPinChangeError] = useState('')

  /* ── App state ── */
  const [records, setRecords] = useState<RecordRow[]>([])
  const [isLoadingRecords, setIsLoadingRecords] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [dataError, setDataError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')

  /* ── New record form ── */
  const [formDate, setFormDate] = useState(todayDateString())
  const [formProcedure, setFormProcedure] = useState('')
  const [formDosage, setFormDosage] = useState('')
  const [formHospital, setFormHospital] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formSession, setFormSession] = useState('')
  const [formContent, setFormContent] = useState('')

  /* ── Edit state ── */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft>({
    record_date: '',
    procedure_name: '',
    dosage_memo: '',
    hospital: '',
    amount: '',
    session_memo: '',
    content: '',
  })
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  /* ── Modal open state ── */
  const [isFormOpen, setIsFormOpen] = useState(false)

  const formContentRef = useRef<HTMLTextAreaElement>(null)
  const editContentRef = useRef<HTMLTextAreaElement>(null)

  const defaultPin = String(import.meta.env.VITE_APP_PIN ?? DEFAULT_PIN).trim()
  const supabaseReady = isSupabaseConfigured()
  const defaultPinHashPromise = useMemo(() => hashPin(defaultPin), [defaultPin])

  /* ── Check remembered auth on load ── */
  useEffect(() => {
    const rememberedAuth = window.localStorage.getItem(AUTH_STORAGE_KEY) === 'true'
    setRememberDevice(rememberedAuth)
    setIsAuthenticated(rememberedAuth)
    setIsCheckingRememberedAuth(false)
  }, [])

  /* ── Auto-clear status message ── */
  useEffect(() => {
    if (!statusMessage) return undefined
    const id = window.setTimeout(() => setStatusMessage(''), 2500)
    return () => window.clearTimeout(id)
  }, [statusMessage])

  /* ── Autosize form textarea ── */
  useLayoutEffect(() => {
    autosizeTextarea(formContentRef.current)
  }, [formContent, isAuthenticated])

  useLayoutEffect(() => {
    if (editingId) {
      autosizeTextarea(editContentRef.current)
    }
  }, [editDraft.content, editingId])

  /* ── PIN hash resolution ── */
  const ensureRemotePinHash = useCallback(async () => {
    const fallbackHash = await defaultPinHashPromise
    if (!supabaseReady) return fallbackHash

    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('skincare_app_settings')
      .select('pin_hash')
      .eq('id', SETTINGS_ROW_ID)
      .maybeSingle()

    if (error) throw error

    if (data?.pin_hash) return data.pin_hash

    const { error: upsertError } = await supabase.from('skincare_app_settings').upsert({
      id: SETTINGS_ROW_ID,
      pin_hash: fallbackHash,
    })
    if (upsertError) throw upsertError

    return fallbackHash
  }, [defaultPinHashPromise, supabaseReady])

  const resolveExpectedPinHash = useCallback(async () => {
    try {
      const remoteHash = await ensureRemotePinHash()
      window.localStorage.setItem(PIN_HASH_STORAGE_KEY, remoteHash)
      return remoteHash
    } catch {
      const saved = window.localStorage.getItem(PIN_HASH_STORAGE_KEY)
      if (saved) return saved
      return defaultPinHashPromise
    }
  }, [defaultPinHashPromise, ensureRemotePinHash])

  /* ── Load records ── */
  const loadRecords = useCallback(async () => {
    if (!supabaseReady) {
      setDataError('Supabase 환경 변수가 설정되지 않았어요. `.env`를 먼저 채워 주세요.')
      setRecords([])
      return
    }

    setIsLoadingRecords(true)
    setDataError('')

    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('skincare_records')
        .select('*')
        .order('record_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error
      setRecords((data ?? []) as RecordRow[])
    } catch (error) {
      setDataError(getErrorMessage(error))
      setRecords([])
    } finally {
      setIsLoadingRecords(false)
    }
  }, [supabaseReady])

  useEffect(() => {
    if (!isAuthenticated) {
      setRecords([])
      setDataError('')
      return
    }
    void loadRecords()
  }, [isAuthenticated, loadRecords])

  /* ── PIN submit ── */
  function handlePinDigits(setter: (v: string) => void, event: ChangeEvent<HTMLInputElement>) {
    setter(event.target.value.replace(/\D/g, '').slice(0, 4))
  }

  async function handlePinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pin.length !== 4) {
      setAuthError('PIN 4자리를 입력해 주세요.')
      return
    }

    try {
      const expectedHash = await resolveExpectedPinHash()
      const inputHash = await hashPin(pin)
      if (inputHash !== expectedHash) {
        setAuthError('입력한 PIN이 일치하지 않습니다.')
        return
      }
    } catch {
      setAuthError('PIN 확인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.')
      return
    }

    if (rememberDevice) {
      window.localStorage.setItem(AUTH_STORAGE_KEY, 'true')
    } else {
      window.localStorage.removeItem(AUTH_STORAGE_KEY)
    }

    setAuthError('')
    setPin('')
    setIsAuthenticated(true)
  }

  function handlePinChange(event: ChangeEvent<HTMLInputElement>) {
    setPin(event.target.value.replace(/\D/g, '').slice(0, 4))
    if (authError) setAuthError('')
  }

  /* ── PIN change ── */
  async function handlePinChangeSave() {
    setPinChangeError('')

    if (currentPinInput.length !== 4) {
      setPinChangeError('현재 PIN 4자리를 입력해 주세요.')
      return
    }
    if (newPinInput.length !== 4) {
      setPinChangeError('새 PIN 4자리를 입력해 주세요.')
      return
    }

    try {
      const expectedHash = await resolveExpectedPinHash()
      const currentHash = await hashPin(currentPinInput)

      if (currentHash !== expectedHash) {
        setPinChangeError('현재 PIN이 일치하지 않습니다.')
        return
      }

      const nextHash = await hashPin(newPinInput)

      if (supabaseReady) {
        const supabase = getSupabaseClient()
        const { error } = await supabase.from('skincare_app_settings').upsert({
          id: SETTINGS_ROW_ID,
          pin_hash: nextHash,
        })
        if (error) throw error
      }

      window.localStorage.setItem(PIN_HASH_STORAGE_KEY, nextHash)
      window.localStorage.removeItem(AUTH_STORAGE_KEY)
      setRememberDevice(false)
      setIsAuthenticated(false)
      setIsChangingPin(false)
      setCurrentPinInput('')
      setNewPinInput('')
      setPin('')
      setAuthError('')
      setStatusMessage('PIN을 변경했어요. 다시 로그인해 주세요.')
    } catch (error) {
      setPinChangeError(getErrorMessage(error))
    }
  }

  /* ── Lock ── */
  function handleLock() {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    setRememberDevice(false)
    setPin('')
    setIsAuthenticated(false)
    setStatusMessage('잠금 화면으로 이동했어요.')
  }

  /* ── Save new record ── */
  async function handleSaveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!supabaseReady) {
      setDataError('Supabase 환경 변수가 설정되지 않아 저장할 수 없어요.')
      return
    }
    const recordDate = formDate || todayDateString()

    setIsSaving(true)
    setDataError('')

    try {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('skincare_records').insert({
        record_date: recordDate,
        procedure_name: formProcedure.trim(),
        dosage_memo: formDosage.trim(),
        hospital: formHospital.trim(),
        amount: formAmount.trim(),
        session_memo: formSession.trim(),
        content: formContent.trim(),
      })

      if (error) throw error

      setFormDate(todayDateString())
      setFormProcedure('')
      setFormDosage('')
      setFormHospital('')
      setFormAmount('')
      setFormSession('')
      setFormContent('')
      setIsFormOpen(false)
      setStatusMessage('기록을 저장했어요.')
      await loadRecords()
    } catch (error) {
      setDataError(getErrorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }

  /* ── Edit ── */
  function startEdit(record: RecordRow) {
    setEditingId(record.id)
    setEditDraft({
      record_date: record.record_date,
      procedure_name: record.procedure_name,
      dosage_memo: record.dosage_memo,
      hospital: record.hospital,
      amount: record.amount,
      session_memo: record.session_memo,
      content: record.content,
    })
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function handleSaveEdit(recordId: string) {
    if (!supabaseReady) {
      setDataError('Supabase 환경 변수가 설정되지 않아 수정할 수 없어요.')
      return
    }

    setIsSavingEdit(true)
    setDataError('')

    try {
      const supabase = getSupabaseClient()
      const { error } = await supabase
        .from('skincare_records')
        .update({
          record_date: editDraft.record_date,
          procedure_name: editDraft.procedure_name.trim(),
          dosage_memo: editDraft.dosage_memo.trim(),
          hospital: editDraft.hospital.trim(),
          amount: editDraft.amount.trim(),
          session_memo: editDraft.session_memo.trim(),
          content: editDraft.content.trim(),
        })
        .eq('id', recordId)

      if (error) throw error

      setEditingId(null)
      setStatusMessage('기록을 수정했어요.')
      await loadRecords()
    } catch (error) {
      setDataError(getErrorMessage(error))
    } finally {
      setIsSavingEdit(false)
    }
  }

  /* ── Delete ── */
  async function handleDeleteRecord(record: RecordRow) {
    if (!supabaseReady) {
      setDataError('Supabase 환경 변수가 설정되지 않아 삭제할 수 없어요.')
      return
    }

    const confirmed = window.confirm('이 기록을 삭제할까요?')
    if (!confirmed) return

    setDataError('')

    try {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('skincare_records').delete().eq('id', record.id)
      if (error) throw error

      if (editingId === record.id) cancelEdit()
      setStatusMessage('기록을 삭제했어요.')
      await loadRecords()
    } catch (error) {
      setDataError(getErrorMessage(error))
    }
  }

  /* ─────────────────────────────────── */
  /* ── Render ── */
  /* ─────────────────────────────────── */

  if (isCheckingRememberedAuth) {
    return (
      <div className="auth-shell">
        <div className="pin-card">
          <p className="pin-subtitle">Skin Care를 준비하는 중...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="auth-shell">
        <form className="pin-card" onSubmit={handlePinSubmit}>
          {isChangingPin ? (
            <>
              <h1>PIN 변경하기</h1>
              <div className="pin-change-panel">
                <label className="field">
                  <span>현재 PIN</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="현재 PIN"
                    value={currentPinInput}
                    onChange={(e) => handlePinDigits(setCurrentPinInput, e)}
                  />
                </label>
                <label className="field">
                  <span>새 PIN</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="새 PIN"
                    value={newPinInput}
                    onChange={(e) => handlePinDigits(setNewPinInput, e)}
                  />
                </label>
                {pinChangeError ? <p className="error-text">{pinChangeError}</p> : null}
                <button type="button" className="secondary-button" onClick={() => void handlePinChangeSave()}>
                  PIN 저장
                </button>
                <button type="button" className="text-button" onClick={() => setIsChangingPin(false)}>
                  로그인으로 돌아가기
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="app-badge">
                <DropletIcon />
                <span>Skin Care</span>
              </div>
              <div className="pin-entry-field">
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder="0000"
                  aria-label="4자리 숫자 입력"
                  value={pin}
                  onChange={handlePinChange}
                  className="pin-entry-input"
                />
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                />
                <span>이 기기 기억하기</span>
              </label>
              {authError ? <p className="error-text">{authError}</p> : null}
              <button type="submit" className="primary-button">
                입장하기
              </button>
              <button
                type="button"
                className="text-button pin-change-button"
                onClick={() => {
                  setIsChangingPin(true)
                  setPinChangeError('')
                  setCurrentPinInput('')
                  setNewPinInput('')
                }}
              >
                PIN 변경하기
              </button>
            </>
          )}
        </form>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <div className="app-icon">
            <DropletIcon />
          </div>
          <h1>Skin Care</h1>
        </div>
        <div className="topbar-actions">
          <button type="button" className="secondary-button lock-button" aria-label="잠금" onClick={handleLock}>
            <LockIcon />
          </button>
        </div>
      </header>

      {!supabaseReady ? (
        <section className="notice-card">
          <h2>Supabase 연결이 필요해요</h2>
          <p>`.env`에 URL, Anon Key, PIN 값을 넣은 뒤 다시 실행해 주세요.</p>
          <p>테이블 설정은 `supabase-schema.sql` 파일에 정리해 두었습니다.</p>
        </section>
      ) : null}

      {dataError ? (
        <section className="notice-card error-card">
          <h2>처리 중 문제가 생겼어요</h2>
          <p>{dataError}</p>
        </section>
      ) : null}

      {statusMessage ? <div className="toast-message">{statusMessage}</div> : null}

      {/* ── New Record Modal ── */}
      {isFormOpen ? (
        <div className="modal-overlay" onClick={() => setIsFormOpen(false)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <p className="modal-title">새 기록 추가</p>
              <button
                type="button"
                className="modal-close-button"
                aria-label="닫기"
                onClick={() => setIsFormOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>
            <form className="record-form" onSubmit={handleSaveRecord}>
              <div className="form-row form-row--single">
                <div className="field">
                  <span>날짜</span>
                  <KoreanDateInput value={formDate} onChange={setFormDate} />
                </div>
              </div>

              <div className="form-row">
                <label className="field">
                  <span>시술 항목</span>
                  <input
                    type="text"
                    value={formProcedure}
                    onChange={(e) => setFormProcedure(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>종류/용량 메모</span>
                  <input
                    type="text"
                    value={formDosage}
                    onChange={(e) => setFormDosage(e.target.value)}
                  />
                </label>
              </div>

              <div className="form-row form-row--single">
                <label className="field">
                  <span>병원</span>
                  <input
                    type="text"
                    value={formHospital}
                    onChange={(e) => setFormHospital(e.target.value)}
                  />
                </label>
              </div>

              <div className="form-row">
                <label className="field">
                  <span>금액</span>
                  <input
                    type="text"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>회차 메모</span>
                  <input
                    type="text"
                    value={formSession}
                    onChange={(e) => setFormSession(e.target.value)}
                  />
                </label>
              </div>

              <div className="form-row form-row--single">
                <label className="field">
                  <span>내용</span>
                  <textarea
                    ref={formContentRef}
                    className="field-textarea"
                    value={formContent}
                    rows={3}
                    onChange={(e) => {
                      setFormContent(e.target.value)
                      requestAnimationFrame(() => autosizeTextarea(formContentRef.current))
                    }}
                  />
                </label>
              </div>

              <div className="form-actions">
                <button type="submit" className="primary-button save-button" disabled={isSaving}>
                  {isSaving ? '저장 중...' : '기록 저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <main className="content-area">
        {/* ── Record List ── */}
        <section className="records-section">
          {isLoadingRecords ? (
            <div className="empty-state">
              <p>기록을 불러오는 중입니다...</p>
            </div>
          ) : null}

          {!isLoadingRecords && records.length === 0 ? (
            <div className="empty-state">
              <div className="empty-illustration">
                <DropletIcon />
              </div>
              <h2>아직 저장된 기록이 없어요</h2>
              <p>+ 버튼을 눌러 첫 번째 시술 기록을 남겨보세요.</p>
            </div>
          ) : null}

          {!isLoadingRecords && records.length > 0 ? (
            <div className="record-list">
              {records.map((record) => {
                const isEditing = editingId === record.id

                return (
                  <div key={record.id} className="record-outer">
                    <div className="record-body-surface">
                      <div className="record-date-header">
                        <p className="record-header-title">
                          {record.procedure_name ? record.procedure_name : '기록'}
                        </p>
                        {!isEditing ? (
                          <div className="record-date-actions">
                            <span className="record-date-inline">{formatRecordDate(record.record_date)}</span>
                            <button
                              type="button"
                              className="record-icon-button record-icon-button--header"
                              aria-label="기록 수정"
                              disabled={editingId !== null}
                              onClick={() => startEdit(record)}
                            >
                              <EditIcon />
                            </button>
                            <button
                              type="button"
                              className="record-icon-button record-icon-button--header"
                              aria-label="기록 삭제"
                              disabled={editingId !== null}
                              onClick={() => void handleDeleteRecord(record)}
                            >
                              <DeleteIcon />
                            </button>
                          </div>
                        ) : null}
                      </div>

                      {isEditing ? (
                        /* ── Edit Mode ── */
                        <div className="record-edit-form">
                          <div className="edit-form-row">
                            <div className="edit-field">
                              <span className="edit-form-label">날짜</span>
                              <KoreanDateInput
                                value={editDraft.record_date}
                                onChange={(v) => setEditDraft((d) => ({ ...d, record_date: v }))}
                                className="edit-korean-date"
                              />
                            </div>
                            <div className="edit-field">
                              <span className="edit-form-label">시술 항목</span>
                              <input
                                type="text"
                                className="record-edit-input"
                                value={editDraft.procedure_name}
                                onChange={(e) => setEditDraft((d) => ({ ...d, procedure_name: e.target.value }))}
                              />
                            </div>
                          </div>

                          <div className="edit-form-row">
                            <div className="edit-field">
                              <span className="edit-form-label">종류/용량 메모</span>
                              <input
                                type="text"
                                className="record-edit-input"
                                value={editDraft.dosage_memo}
                                onChange={(e) => setEditDraft((d) => ({ ...d, dosage_memo: e.target.value }))}
                              />
                            </div>
                            <div className="edit-field">
                              <span className="edit-form-label">병원</span>
                              <input
                                type="text"
                                className="record-edit-input"
                                value={editDraft.hospital}
                                onChange={(e) => setEditDraft((d) => ({ ...d, hospital: e.target.value }))}
                              />
                            </div>
                          </div>

                          <div className="edit-form-row">
                            <div className="edit-field">
                              <span className="edit-form-label">금액</span>
                              <input
                                type="text"
                                className="record-edit-input"
                                value={editDraft.amount}
                                onChange={(e) => setEditDraft((d) => ({ ...d, amount: e.target.value }))}
                              />
                            </div>
                            <div className="edit-field">
                              <span className="edit-form-label">회차 메모</span>
                              <input
                                type="text"
                                className="record-edit-input"
                                value={editDraft.session_memo}
                                onChange={(e) => setEditDraft((d) => ({ ...d, session_memo: e.target.value }))}
                              />
                            </div>
                          </div>

                          <div className="edit-field">
                            <span className="edit-form-label">내용</span>
                            <textarea
                              ref={editContentRef}
                              className="record-edit-textarea"
                              value={editDraft.content}
                              rows={3}
                              onChange={(e) => {
                                setEditDraft((d) => ({ ...d, content: e.target.value }))
                                requestAnimationFrame(() => autosizeTextarea(editContentRef.current))
                              }}
                            />
                          </div>

                          <div className="edit-actions">
                            <button
                              type="button"
                              className="edit-cancel-button"
                              onClick={cancelEdit}
                              disabled={isSavingEdit}
                            >
                              취소
                            </button>
                            <button
                              type="button"
                              className="edit-save-button"
                              onClick={() => void handleSaveEdit(record.id)}
                              disabled={isSavingEdit}
                            >
                              {isSavingEdit ? '저장 중...' : '저장'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* ── View Mode ── */
                        <div className="record-body">
                          {/* Left column: 시술/용량/병원/금액/회차 */}
                          <div className="record-col record-col--meta">
                            {record.dosage_memo ? (
                              <div className="record-row">
                                <div className="record-field">
                                  <span className="record-field-value">{record.dosage_memo}</span>
                                </div>
                              </div>
                            ) : null}

                            {record.hospital ? (
                              <div className="record-row">
                                <div className="record-field">
                                  <span className="record-field-value">{record.hospital}</span>
                                </div>
                              </div>
                            ) : null}

                            {(record.amount || record.session_memo) ? (
                              <div className="record-row">
                                <div className="record-field">
                                  {record.amount ? <span className="record-field-value">{record.amount}</span> : null}
                                  {record.session_memo ? (
                                    <span className="record-field-value record-field-value--paren">
                                      {' '}
                                      ({record.session_memo})
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}
                          </div>

                          {/* Right column: 내용 */}
                          {record.content ? (
                            <div className="record-col record-col--content">
                              <div className="record-content-wrap">
                                <p className="record-content">{record.content}</p>
                              </div>
                            </div>
                          ) : (
                            <div className="record-col record-col--content record-col--content-empty" />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}
        </section>
      </main>
      {/* ── FAB ── */}
      <button
        type="button"
        className="fab"
        aria-label="새 기록 추가"
        onClick={() => {
          setFormDate(todayDateString())
          setIsFormOpen(true)
        }}
      >
        <PlusIcon />
      </button>
    </div>
  )
}

/* ─── Icons ─── */

function DropletIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.5 C12 3.5 6 9.5 6 14 A6 6 0 0 0 18 14 C18 9.5 12 3.5 12 3.5Z"
        fill="currentColor"
        opacity="0.18"
      />
      <path
        d="M12 3.5 C12 3.5 6 9.5 6 14 A6 6 0 0 0 18 14 C18 9.5 12 3.5 12 3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M9 13.5 A3.5 3.5 0 0 1 12 10.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m5 16.75 9.8-9.8a1.8 1.8 0 0 1 2.55 0l.7.7a1.8 1.8 0 0 1 0 2.55L8.25 20H5v-3.25Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5.5 7.5h13M9.5 4.75h5l.75 2.75m-8 0 .55 9.2A2 2 0 0 0 9.8 18.6h4.4a2 2 0 0 0 1.99-1.9l.56-9.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M3.5 9.5h17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8 3v3M16 3v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="8.5" cy="14" r="1" fill="currentColor" />
      <circle cx="12" cy="14" r="1" fill="currentColor" />
      <circle cx="15.5" cy="14" r="1" fill="currentColor" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.5 11V8.75a4.5 4.5 0 1 1 9 0V11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M7.25 11h9.5a2 2 0 0 1 2 2v5.5a2.25 2.25 0 0 1-2.25 2.25h-9A2.25 2.25 0 0 1 5.25 18.5V13a2 2 0 0 1 2-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M12 15.3v2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default App
