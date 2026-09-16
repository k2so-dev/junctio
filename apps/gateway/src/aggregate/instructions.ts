export type InstructionSection = {
  prefix: string;
  text: string | null | undefined;
};

export function composeInstructions(
  preamble: string | null | undefined,
  sections: InstructionSection[]
): string | undefined {
  const parts: string[] = [];
  const head = preamble?.trim();
  if (head) parts.push(head);
  for (const section of sections) {
    const text = section.text?.trim();
    if (text) parts.push(`## ${section.prefix}\n\n${text}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}
