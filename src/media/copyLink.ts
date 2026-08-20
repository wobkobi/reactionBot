// src/media/copyLink.ts

// Builds the private hand-over that gives a poster a rewritten link instead of
// touching their message, shared by the media and tracking-clean prompts.

/**
 * Builds the private reply handing the poster a link. The URL sits in a fenced
 * block so Discord renders no embed and mobile clients show a copy button.
 * @param url - The link to hand over.
 * @param lead - Line shown above the fenced URL, naming what was done to it.
 * @param [footer] - Subtext line under the block, for a hint the poster can act
 * on. Omitted where there is nothing useful to offer.
 * @returns The message content to send.
 */
export function buildCopyMessage(url: string, lead: string, footer?: string): string {
  const body = `${lead}\n\`\`\`\n${url}\n\`\`\``;
  return footer ? `${body}\n${footer}` : body;
}
