import React from 'react'
import type { GalleryInfo, GalleryType } from '../../../shared/ipc-types'

interface Props {
  galleryId: string
  galleryType: GalleryType
  galleryInfo: GalleryInfo | null
  isVerifying: boolean
  onIdChange: (id: string) => void
  onTypeChange: (t: GalleryType) => void
  onVerify: () => void
}

const GALLERY_TYPES: { label: string; value: GalleryType }[] = [
  { label: '메이저', value: 0 },
  { label: '마이너', value: 1 },
  { label: '미니', value: 2 }
]

export function GalleryInput({
  galleryId,
  galleryType,
  galleryInfo,
  isVerifying,
  onIdChange,
  onTypeChange,
  onVerify
}: Props): React.JSX.Element {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onVerify()
  }

  return (
    <div className="card">
      <div className="card-title">갤러리 설정</div>

      {/* 갤러리 유형 선택 (Segmented Control) */}
      <div className="segmented-control" style={{ marginBottom: '4px' }}>
        {GALLERY_TYPES.map((t) => (
          <label
            key={t.value}
            className={`segment-label ${galleryType === t.value ? 'selected' : ''} ${isVerifying ? 'disabled' : ''}`}
          >
            <input
              type="radio"
              name="galleryType"
              value={t.value}
              checked={galleryType === t.value}
              onChange={() => onTypeChange(t.value)}
              disabled={isVerifying}
            />
            {t.label}
          </label>
        ))}
      </div>

      {/* ID 입력 및 검증 버튼 */}
      <div className="row-flex">
        <input
          className="input input-full"
          type="text"
          placeholder="갤러리 ID"
          value={galleryId}
          onChange={(e) => onIdChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isVerifying}
          style={{ flex: 1 }}
        />
        <button
          className="btn btn-primary"
          onClick={onVerify}
          disabled={isVerifying || !galleryId}
          style={{ padding: '6px 12px' }}
        >
          {isVerifying ? '…' : '검증'}
        </button>
      </div>

      {/* 상태 메세지 */}
      {galleryInfo && (
        <div className="status-ok">✓ {galleryInfo.name}</div>
      )}
    </div>
  )
}
