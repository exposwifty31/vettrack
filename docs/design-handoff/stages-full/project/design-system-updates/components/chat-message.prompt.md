ChatMessage — proposed addition (§21-D2), not yet in the published bundle.
Import from `@/components/general/chat-message` once merged. Genuinely new —
no chat component exists in the real DS yet.

Three variants: `normal` (ordinary bubble, aligns via `own`), `broadcast`
(indigo border + ack-progress bar), `urgent` (red border). Broadcast and
urgent are visually distinct by border + treatment, never by color alone.
Alignment uses logical `ms-auto`/`me-auto`, correct under both `dir="ltr"`
and `dir="rtl"`.

## Props

```ts
type ChatMessageProps = {
  variant?: "normal" | "broadcast" | "urgent";
  from: string;
  own?: boolean;
  children: React.ReactNode;
  className?: string;
} & (
  // broadcast progress is all-or-nothing — ackLabel required whenever ackPercent is set
  | { ackPercent?: undefined; ackLabel?: undefined }
  | { ackPercent: number; ackLabel: string }
);
```

## Usage

```jsx
<ChatMessage variant="broadcast" from="Maya Abbas" ackPercent={66} ackLabel="4 / 6 acknowledged">
  Supply restock needed in Bay 3
</ChatMessage>

<ChatMessage variant="urgent" from="Tech Ruiz">
  Portable X-ray failed check — pulling from rotation
</ChatMessage>

<ChatMessage from="Dr. Lee">Anyone free to help with intake in Recovery?</ChatMessage>
<ChatMessage from="You" own>On my way</ChatMessage>
```
