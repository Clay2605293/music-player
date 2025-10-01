export default function NoteChip({ label, active }) {
  return (
    <div className={`chip ${active ? 'active' : ''}`}>
      <span className="spark" />
      <span className="text">{label}</span>
    </div>
  )
}
