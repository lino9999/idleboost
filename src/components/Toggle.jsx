import Tip from './Tip';

export default function Toggle({ checked, onChange, tip, disabled = false }) {
  const btn = (
    <button
      onClick={() => !disabled && onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-steam/70' : 'bg-night-600'
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  );
  if (!tip) return btn;
  return <Tip tip={tip}>{btn}</Tip>;
}
