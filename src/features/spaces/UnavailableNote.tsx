import './spaces.css'

export default function UnavailableNote({ text }: { text: string }) {
  return <p className="unavailable-note">{text}</p>
}
