import { OUTBOUND_CHANNELS } from './constants.js';

export function selectChannel(profile, settings) {
  const consented = new Set(profile.consented_channels ?? []);
  const available = new Set(profile.available_channels ?? []);
  const order = [
    ...(profile.preferred_channel ? [profile.preferred_channel] : []),
    ...settings.defaultChannelPriority,
  ].filter((c, i, all) => all.indexOf(c) === i);
  const tried = [];
  for (const channel of order) {
    if (!OUTBOUND_CHANNELS.includes(channel)) {
      tried.push({ channel, eligible: false, why: 'not an outbound channel' });
    } else if (!consented.has(channel)) {
      tried.push({ channel, eligible: false, why: 'no consent' });
    } else if (!available.has(channel)) {
      tried.push({ channel, eligible: false, why: 'not available' });
    } else {
      tried.push({ channel, eligible: true, why: 'consented and available' });
      return { channel, tried };
    }
  }
  return { channel: null, tried };
}
