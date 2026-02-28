import { useState } from 'react'
import './GalleryInput.css'

const GALLERY_TYPES = [
  { value: 0, label: '갤러리' },
  { value: 1, label: '마이너갤러리' },
  { value: 2, label: '미니갤러리' },
]

export default function GalleryInput({ gallery, onChange, disabled }) {
  const [checking, setChecking] = useState(false)
  const [checkMsg, setCheckMsg] = useState('')

  const handleCheck = async () => {
    if (!gallery.gallId.trim()) return
    setChecking(true)
    setCheckMsg('')

    const res = await window.dcAPI.checkGallery(gallery.gallId.trim(), gallery.gallType)
    setChecking(false)

    if (res.ok) {
      onChange({ ...gallery, gallId: gallery.gallId.trim(), gallName: res.gallName })
      setCheckMsg(`✓ ${res.gallName}`)
    } else {
      onChange({ ...gallery, gallName: '' })
      setCheckMsg(`✗ ${res.message}`)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleCheck()
  }

  return (
    <section className="card">
      <h2 className="card-title">갤러리 설정</h2>

      <div className="type-row">
        {GALLERY_TYPES.map(t => (
          <label key={t.value} className={`type-radio ${gallery.gallType === t.value ? 'active' : ''}`}>
            <input
              type="radio"
              name="gallType"
              value={t.value}
              checked={gallery.gallType === t.value}
              disabled={disabled}
              onChange={() => onChange({ ...gallery, gallType: t.value, gallName: '' })}
            />
            {t.label}
          </label>
        ))}
      </div>

      <div className="id-row">
        <input
          className="id-input"
          type="text"
          placeholder="갤러리 ID"
          value={gallery.gallId}
          disabled={disabled}
          onChange={e => onChange({ ...gallery, gallId: e.target.value, gallName: '' })}
          onKeyDown={handleKeyDown}
        />
        <button
          className="btn-check"
          onClick={handleCheck}
          disabled={disabled || checking || !gallery.gallId.trim()}
        >
          {checking ? '확인 중...' : '검증'}
        </button>
      </div>

      {checkMsg && (
        <div className={`check-msg ${checkMsg.startsWith('✓') ? 'ok' : 'err'}`}>
          {checkMsg}
        </div>
      )}
    </section>
  )
}
