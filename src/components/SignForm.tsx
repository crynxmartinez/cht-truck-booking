'use client';

import { useState } from 'react';
import { Terms } from './Terms';
import { SignaturePad } from './SignaturePad';
import { DAMAGE_WAIVER_NOTICE, READ_AND_SIGN, TOLL_AGREEMENT, TOLL_CHECKBOX_LABEL } from '@/lib/contract-terms';

export type SignFormProps = {
  token: string;
  type: 'RENTAL_AGREEMENT' | 'ADDITIONAL_DRIVER';
  reference: string;
  clientName: string;
  dateLabel: string;
  pickupDateLabel: string;
  returnDateLabel: string;
  truck: { code: string; plate: string; year: number } | null;
  pickupAddress: string;
  prefill: Record<string, string>;
  mainRenterName?: string;
  alreadySigned: boolean;
  pdfUrl?: string | null;
};

type Errors = Record<string, string>;

export function SignForm(props: SignFormProps) {
  const isAdditional = props.type === 'ADDITIONAL_DRIVER';

  const [f, setF] = useState<Record<string, string>>({
    clientName: props.clientName,
    name: props.clientName,
    phone: props.prefill.phone ?? '',
    email: props.prefill.email ?? '',
    employer: '',
    employerPhone: '',
    oldStreet: '',
    oldCity: '',
    oldState: 'CA',
    oldZip: '',
    newStreet: '',
    newCity: '',
    newState: 'CA',
    newZip: '',
    street: '',
    city: '',
    state: 'CA',
    zip: '',
    licenseNo: '',
    dob: '',
    insuranceCarrier: '',
    insurancePhone: '',
    insurancePolicyNo: '',
    mainRenterName: props.mainRenterName ?? '',
    ...props.prefill,
  });

  const [initials, setInitials] = useState('');
  const [tollAccepted, setTollAccepted] = useState(false);
  const [wantsAdditional, setWantsAdditional] = useState<'yes' | 'no' | ''>('');
  const [addDriver, setAddDriver] = useState({ name: '', email: '', phone: '' });
  const [signature, setSignature] = useState<string | null>(null);
  const [signerName, setSignerName] = useState(props.clientName);
  const [hasRead, setHasRead] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState('');
  const [done, setDone] = useState(props.alreadySigned);
  const [pdf, setPdf] = useState(props.pdfUrl ?? null);
  // What the SERVER says happened, not what this form asked for. A resubmit
  // used to claim the second driver had been emailed when they had not.
  const [driverInvited, setDriverInvited] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setF((prev) => ({ ...prev, [k]: e.target.value }));
    setErrors((prev) => (prev[k] ? { ...prev, [k]: '' } : prev));
  };

  function validate(): boolean {
    const e: Errors = {};
    const need = (k: string, label: string, min = 2) => {
      if ((f[k] ?? '').trim().length < min) e[k] = `${label} is required.`;
    };

    if (isAdditional) {
      need('name', 'Your full name');
      need('street', 'Street address');
      need('city', 'City');
      need('zip', 'ZIP', 5);
    } else {
      need('clientName', 'Your full name');
      need('oldStreet', 'Current address');
      need('oldCity', 'City');
      need('oldZip', 'ZIP', 5);
    }
    need('phone', 'Phone', 10);
    need('licenseNo', "Driver's licence number", 4);
    need('dob', 'Date of birth', 6);
    need('insuranceCarrier', 'Insurance carrier');
    need('insurancePolicyNo', 'Policy number', 3);

    if (initials.trim().length < 2) e.initials = 'Please initial the damage waiver.';
    if (!tollAccepted) e.toll = 'Please tick the toll agreement to continue.';
    if (!isAdditional && !wantsAdditional) e.wantsAdditional = 'Please answer yes or no.';
    if (!isAdditional && wantsAdditional === 'yes') {
      if (addDriver.name.trim().length < 2) e.adName = "Enter the additional driver's name.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addDriver.email.trim())) e.adEmail = 'Enter a valid email so we can send them their agreement.';
      if (addDriver.phone.replace(/\D/g, '').length < 10) e.adPhone = 'Enter their mobile number.';
    }
    if (!hasRead) e.terms = 'Please scroll through the full agreement first.';
    if (!signature) e.signature = 'Please sign above.';

    setErrors(e);
    if (Object.keys(e).length) {
      const first = document.querySelector('[data-invalid="true"]');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    return true;
  }

  async function submit() {
    if (!validate()) return;
    setBusy(true);
    setFail('');
    try {
      const res = await fetch(`/api/sign/${props.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: f,
          initials,
          signerName: signerName || f.clientName || f.name,
          signatureDataUrl: signature,
          tollAccepted,
          additionalDriver: !isAdditional && wantsAdditional === 'yes' ? addDriver : null,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not save your signature.');
      setPdf(j.pdfUrl ?? null);
      setDriverInvited(Boolean(j.additionalDriverInvited));
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setFail(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const inv = (k: string) => (errors[k] ? { 'aria-invalid': true as const, 'data-invalid': 'true' } : {});
  const Err = ({ k }: { k: string }) => (errors[k] ? <div className="err">{errors[k]}</div> : null);

  if (done) {
    return (
      <div className="card-bd center" style={{ padding: '40px 24px 44px' }}>
        <div className="tick">&#10003;</div>
        <h1>Signed and on file</h1>
        <p className="lede">
          {isAdditional
            ? 'Thanks — you are cleared to drive this rental.'
            : driverInvited
              ? `We are sending ${addDriver.name || 'your additional driver'} their own agreement now. Once they sign, your confirmation goes out.`
              : 'Your confirmation is on its way by email and text.'}
        </p>
        <div className="recap">
          <div>
            <span>Reference</span>
            <b>{props.reference}</b>
          </div>
          <div>
            <span>Truck</span>
            <b>{props.truck ? `${props.truck.code} · ${props.truck.plate}` : '—'}</b>
          </div>
          <div>
            <span>Pickup</span>
            <b>{props.pickupDateLabel}</b>
          </div>
          <div>
            <span>Due back</span>
            <b>{props.returnDateLabel}</b>
          </div>
          <div>
            <span>Pickup location</span>
            <b>{props.pickupAddress}</b>
          </div>
        </div>
        {pdf ? (
          <p style={{ marginTop: 20 }}>
            <a className="btn ghost small" href={pdf} target="_blank" rel="noreferrer">
              Download your signed copy (PDF)
            </a>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className="card-bd">
        <h1>{isAdditional ? 'Additional driver agreement' : 'Your truck rental agreement'}</h1>
        <p className="lede">
          {isAdditional
            ? `${props.mainRenterName || 'The renter'} listed you as an additional driver. Fill this in and sign to be cleared.`
            : 'A few details we could not fill in for you, then a signature. About two minutes.'}
        </p>

        <div className="note info">
          <b>
            Truck {props.truck?.code ?? '—'} · {props.pickupDateLabel}
          </b>
          Due back {props.returnDateLabel} at {props.pickupAddress}
        </div>

        {fail ? <div className="note alert">{fail}</div> : null}

        <h3>Your details</h3>
        <div className="row two">
          <div>
            <label htmlFor="nm">Full name <em>*</em></label>
            <input
              id="nm"
              type="text"
              value={isAdditional ? f.name : f.clientName}
              onChange={set(isAdditional ? 'name' : 'clientName')}
              {...inv(isAdditional ? 'name' : 'clientName')}
            />
            <Err k={isAdditional ? 'name' : 'clientName'} />
          </div>
          <div>
            <label htmlFor="ph">Phone <em>*</em></label>
            <input id="ph" type="tel" value={f.phone} onChange={set('phone')} {...inv('phone')} />
            <Err k="phone" />
          </div>
        </div>

        <div className="row two">
          <div>
            <label htmlFor="emp">Employer / company</label>
            <input id="emp" type="text" value={f.employer} onChange={set('employer')} />
          </div>
          <div>
            <label htmlFor="empph">Company phone</label>
            <input id="empph" type="tel" value={f.employerPhone} onChange={set('employerPhone')} />
          </div>
        </div>

        {isAdditional ? (
          <>
            <h3>Address</h3>
            <div className="row">
              <label htmlFor="st">Street address <em>*</em></label>
              <input id="st" type="text" value={f.street} onChange={set('street')} {...inv('street')} />
              <Err k="street" />
            </div>
            <div className="row three">
              <div>
                <label htmlFor="ct">City <em>*</em></label>
                <input id="ct" type="text" value={f.city} onChange={set('city')} {...inv('city')} />
                <Err k="city" />
              </div>
              <div>
                <label htmlFor="sr">State</label>
                <input id="sr" type="text" value={f.state} onChange={set('state')} maxLength={2} />
              </div>
              <div>
                <label htmlFor="zp">ZIP <em>*</em></label>
                <input id="zp" type="text" value={f.zip} onChange={set('zip')} {...inv('zip')} />
                <Err k="zip" />
              </div>
            </div>
            <div className="row">
              <label htmlFor="mrn">Name of the person who booked the rental</label>
              <input id="mrn" type="text" value={f.mainRenterName} onChange={set('mainRenterName')} />
            </div>
          </>
        ) : (
          <>
            <h3>Current address</h3>
            <div className="row">
              <label htmlFor="os">Street <em>*</em></label>
              <input id="os" type="text" value={f.oldStreet} onChange={set('oldStreet')} {...inv('oldStreet')} />
              <Err k="oldStreet" />
            </div>
            <div className="row three">
              <div>
                <label htmlFor="oc">City <em>*</em></label>
                <input id="oc" type="text" value={f.oldCity} onChange={set('oldCity')} {...inv('oldCity')} />
                <Err k="oldCity" />
              </div>
              <div>
                <label htmlFor="ost">State</label>
                <input id="ost" type="text" value={f.oldState} onChange={set('oldState')} maxLength={2} />
              </div>
              <div>
                <label htmlFor="oz">ZIP <em>*</em></label>
                <input id="oz" type="text" value={f.oldZip} onChange={set('oldZip')} {...inv('oldZip')} />
                <Err k="oldZip" />
              </div>
            </div>

            <h3>Where you are moving to</h3>
            <p className="tiny" style={{ marginTop: -4, marginBottom: 10 }}>
              Leave blank if this is not a move.
            </p>
            <div className="row">
              <label htmlFor="ns">Street</label>
              <input id="ns" type="text" value={f.newStreet} onChange={set('newStreet')} />
            </div>
            <div className="row three">
              <div>
                <label htmlFor="nc">City</label>
                <input id="nc" type="text" value={f.newCity} onChange={set('newCity')} />
              </div>
              <div>
                <label htmlFor="nst">State</label>
                <input id="nst" type="text" value={f.newState} onChange={set('newState')} maxLength={2} />
              </div>
              <div>
                <label htmlFor="nz">ZIP</label>
                <input id="nz" type="text" value={f.newZip} onChange={set('newZip')} />
              </div>
            </div>
          </>
        )}

        <h3>Licence and insurance</h3>
        <div className="row two">
          <div>
            <label htmlFor="dl">Driver&rsquo;s licence no. <em>*</em></label>
            <input id="dl" type="text" value={f.licenseNo} onChange={set('licenseNo')} {...inv('licenseNo')} />
            <Err k="licenseNo" />
          </div>
          <div>
            <label htmlFor="db">Date of birth <em>*</em></label>
            <input id="db" type="text" placeholder="MM/DD/YYYY" value={f.dob} onChange={set('dob')} {...inv('dob')} />
            <Err k="dob" />
          </div>
        </div>
        <div className="row three">
          <div>
            <label htmlFor="ic">Insurance carrier <em>*</em></label>
            <input id="ic" type="text" value={f.insuranceCarrier} onChange={set('insuranceCarrier')} {...inv('insuranceCarrier')} />
            <Err k="insuranceCarrier" />
          </div>
          <div>
            <label htmlFor="ip">Carrier phone</label>
            <input id="ip" type="tel" value={f.insurancePhone} onChange={set('insurancePhone')} />
          </div>
          <div>
            <label htmlFor="ipn">Policy no. <em>*</em></label>
            <input id="ipn" type="text" value={f.insurancePolicyNo} onChange={set('insurancePolicyNo')} {...inv('insurancePolicyNo')} />
            <Err k="insurancePolicyNo" />
          </div>
        </div>

        <h3>Damage waiver</h3>
        <div className="note warn">{DAMAGE_WAIVER_NOTICE}</div>
        <div className="row" style={{ maxWidth: 220 }}>
          <label htmlFor="ini">Your initials <em>*</em></label>
          <input
            id="ini"
            type="text"
            maxLength={5}
            value={initials}
            onChange={(e) => {
              setInitials(e.target.value.toUpperCase());
              setErrors((p) => ({ ...p, initials: '' }));
            }}
            {...inv('initials')}
          />
          <Err k="initials" />
        </div>

        <h3>Tolls</h3>
        <div className="note warn">{TOLL_AGREEMENT}</div>
        <label className="check" {...inv('toll')}>
          <input
            type="checkbox"
            checked={tollAccepted}
            onChange={(e) => {
              setTollAccepted(e.target.checked);
              setErrors((p) => ({ ...p, toll: '' }));
            }}
          />
          <span>
            {TOLL_CHECKBOX_LABEL} <em>*</em>
          </span>
        </label>
        <Err k="toll" />

        {!isAdditional ? (
          <>
            <h3>Is anyone else going to drive?</h3>
            <p className="tiny" style={{ marginTop: -4, marginBottom: 10 }}>
              Only people named on this agreement are covered. If someone else drives, they need to sign too.
            </p>
            <div className="row" style={{ display: 'flex', gap: 10 }} {...inv('wantsAdditional')}>
              <button
                type="button"
                className={wantsAdditional === 'no' ? 'btn primary' : 'btn ghost'}
                onClick={() => {
                  setWantsAdditional('no');
                  setErrors((p) => ({ ...p, wantsAdditional: '' }));
                }}
              >
                No, just me
              </button>
              <button
                type="button"
                className={wantsAdditional === 'yes' ? 'btn primary' : 'btn ghost'}
                onClick={() => {
                  setWantsAdditional('yes');
                  setErrors((p) => ({ ...p, wantsAdditional: '' }));
                }}
              >
                Yes, add a driver
              </button>
            </div>
            <Err k="wantsAdditional" />

            {wantsAdditional === 'yes' ? (
              <div className="note info" style={{ marginTop: 4 }}>
                <b>We&rsquo;ll send them their own agreement</b>
                <div className="row" style={{ marginTop: 10, marginBottom: 10 }}>
                  <label htmlFor="adn">Their full name <em>*</em></label>
                  <input
                    id="adn"
                    type="text"
                    value={addDriver.name}
                    onChange={(e) => setAddDriver((p) => ({ ...p, name: e.target.value }))}
                    {...inv('adName')}
                  />
                  <Err k="adName" />
                </div>
                <div className="row two" style={{ marginBottom: 0 }}>
                  <div>
                    <label htmlFor="ade">Their email <em>*</em></label>
                    <input
                      id="ade"
                      type="email"
                      value={addDriver.email}
                      onChange={(e) => setAddDriver((p) => ({ ...p, email: e.target.value }))}
                      {...inv('adEmail')}
                    />
                    <Err k="adEmail" />
                  </div>
                  <div>
                    <label htmlFor="adp">Their mobile <em>*</em></label>
                    <input
                      id="adp"
                      type="tel"
                      value={addDriver.phone}
                      onChange={(e) => setAddDriver((p) => ({ ...p, phone: e.target.value }))}
                      {...inv('adPhone')}
                    />
                    <Err k="adPhone" />
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        <h3>The agreement</h3>
        <div {...inv('terms')}>
          <Terms
            clientName={isAdditional ? f.name : f.clientName}
            dateLabel={props.dateLabel}
            onRead={() => {
              setHasRead(true);
              setErrors((p) => ({ ...p, terms: '' }));
            }}
          />
        </div>
        <Err k="terms" />

        <h3>Sign here</h3>
        <p className="tiny" style={{ marginTop: -4, marginBottom: 10 }}>
          {READ_AND_SIGN}
        </p>
        <div {...inv('signature')}>
          <SignaturePad
            defaultName={isAdditional ? f.name : f.clientName}
            onChange={(data, name) => {
              setSignature(data);
              if (name) setSignerName(name);
              if (data) setErrors((p) => ({ ...p, signature: '' }));
            }}
          />
        </div>
        <Err k="signature" />
      </div>

      <div className="card-ft">
        <div className="tiny">Your signature is timestamped and recorded.</div>
        <div className="spacer" />
        <button type="button" className="btn primary" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : 'Sign agreement'}
        </button>
      </div>
    </>
  );
}
