import { useRef, useState } from 'react'

import { kycApi } from '../../api/api'
import { ID_TYPE_LABEL } from '../../api/types'
import type { IdType, KycInput, MyKyc } from '../../api/types'
import { Page } from '../../components/AppShell'
import { Async, Banner, Button, Card, ErrorNote, Field, LinkButton, PageHead, Select, Small } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { formatDate } from '../../lib/format'
import { fileToDataUrl } from '../../lib/images'

type Slot = 'front' | 'back' | 'selfie'

// One photo to upload: shows a preview once chosen.
function ImageSlot({ label, value, onChange }: { label: string; value?: string; onChange: (url?: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const pick = async (file?: File) => {
    if (!file) return
    setError(null)
    try {
      onChange(await fileToDataUrl(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the photo')
    } finally {
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div>
      <div className="mb-1.5 text-sm font-bold">{label}</div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex h-28 w-full items-center justify-center overflow-hidden rounded-2xl border-[1.5px] border-dashed border-neutral-300 bg-neutral-50 text-[13px] font-medium text-neutral-500 transition hover:border-brand hover:bg-brand-tint hover:text-brand-ink"
      >
        {value ? <img src={value} alt={label} className="h-full w-full object-cover" /> : 'Choose a photo'}
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      {value && (
        <button type="button" onClick={() => onChange(undefined)} className="mt-1 text-[13px] font-bold text-danger">
          Remove
        </button>
      )}
      {error && <div role="alert" className="mt-1 text-[13px] text-danger">{error}</div>}
    </div>
  )
}

function Result({ kyc, onRetry }: { kyc: MyKyc; onRetry: () => void }) {
  if (kyc.status === 'verified') {
    return (
      <div className="flex flex-col gap-4">
        <Banner icon="check" title="You are verified">
          {kyc.verifiedAt ? `Verified on ${formatDate(kyc.verifiedAt)}. ` : ''}You can now apply for jobs.
        </Banner>
        <Card>
          <div className="text-[17px] font-bold">{kyc.fullName}</div>
          <Small className="mt-0.5">{ID_TYPE_LABEL[kyc.idType]} · {kyc.idNumber}</Small>
        </Card>
        <LinkButton to="/worker/jobs" tone="primary">Find jobs</LinkButton>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <Banner tone="red" icon="alert" title="We could not verify you">
        Fix the points below and try again.
      </Banner>
      <Card>
        <ul className="list-disc space-y-1 pl-5 text-[15px]">
          {kyc.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </Card>
      <Button tone="primary" onClick={onRetry}>Try again</Button>
    </div>
  )
}

// Identity check for workers. A worker must be verified before applying for jobs.
export default function Verification() {
  const state = useAsync(kycApi.me)
  const [retrying, setRetrying] = useState(false)
  const [form, setForm] = useState<KycInput>({
    fullName: '',
    idType: 'national_id',
    idNumber: '',
    dateOfBirth: '',
    consent: false,
    images: {},
  })
  const [step, setStep] = useState<'details' | 'photos'>('details')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MyKyc | null>(null)

  const set = <K extends keyof KycInput>(key: K, value: KycInput[K]) => setForm((f) => ({ ...f, [key]: value }))
  const setImage = (slot: Slot, url?: string) => setForm((f) => ({ ...f, images: { ...f.images, [slot]: url } }))

  const detailsValid = form.fullName.trim() !== '' && form.idNumber.trim() !== '' && form.dateOfBirth !== ''
  const slots: Array<{ slot: Slot; label: string }> =
    form.idType === 'passport'
      ? [{ slot: 'front', label: 'Passport photo page' }, { slot: 'selfie', label: 'Selfie' }]
      : [{ slot: 'front', label: 'ID front' }, { slot: 'back', label: 'ID back' }, { slot: 'selfie', label: 'Selfie' }]
  const photosReady = slots.every(({ slot }) => form.images[slot])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await kycApi.submit(form))
      setRetrying(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your details')
    } finally {
      setBusy(false)
    }
  }

  const retry = () => {
    setResult(null)
    setStep('details')
    setRetrying(true)
    setForm((f) => ({ ...f, consent: false }))
  }

  return (
    <Page header={<PageHead title="Verify your identity" sub="Needed before you can apply for jobs" />}>
      <Async state={state}>
        {(saved) => {
          const outcome = result ?? (retrying ? null : saved)
          if (outcome) return <Result kyc={outcome} onRetry={retry} />

          return (
            <div className="flex max-w-xl flex-col gap-4">
              <Banner icon="shield" title="Simulated check">
                This is a demonstration. Your details are checked automatically and no real ID service is used. Only the
                last 3 digits of your ID number are ever shown to clients.
              </Banner>
              {error && <ErrorNote message={error} />}

              {step === 'details' ? (
                <Card className="gap-4">
                  <Field label="Full name on the ID" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} hint="Must match the name on your account." />
                  <Select label="ID type" value={form.idType} onChange={(e) => set('idType', e.target.value as IdType)}>
                    <option value="national_id">National ID</option>
                    <option value="passport">Passport</option>
                  </Select>
                  <Field label="ID number" value={form.idNumber} onChange={(e) => set('idNumber', e.target.value)} />
                  <Field label="Date of birth" type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
                  <Button tone="primary" disabled={!detailsValid} onClick={() => setStep('photos')}>Next: photos</Button>
                </Card>
              ) : (
                <Card className="gap-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    {slots.map(({ slot, label }) => (
                      <ImageSlot key={slot} label={label} value={form.images[slot]} onChange={(url) => setImage(slot, url)} />
                    ))}
                  </div>
                  <label className="flex items-start gap-2.5 text-[14.5px] leading-snug">
                    <input type="checkbox" className="mt-1 h-4 w-4" checked={form.consent} onChange={(e) => set('consent', e.target.checked)} />
                    I agree that my ID details and photos are stored and checked to verify who I am. Admins can see them
                    only if I am part of a dispute.
                  </label>
                  <div className="flex gap-2">
                    <Button className="w-auto px-6" disabled={busy} onClick={() => setStep('details')}>Back</Button>
                    <Button tone="primary" disabled={busy || !photosReady || !form.consent} onClick={() => void submit()}>
                      {busy ? 'Checking…' : 'Submit for checking'}
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          )
        }}
      </Async>
    </Page>
  )
}
