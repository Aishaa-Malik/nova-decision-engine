import { DECISIONS } from './constants.js';
import { selectChannel } from './channels.js';

const iso = (ms) => new Date(ms).toISOString();
const minutes = (ms) => Math.round(ms / 60000);

export const hasAbandonmentCandidate = {
  name: 'CART_ACTIVITY',
  evaluate(ctx) {
    if (ctx.targetCart) return null;
    return {
      decision: DECISIONS.SUPPRESS,
      reason: 'No cart or checkout activity found for this customer, so there is nothing to follow up on.',
    };
  },
};

export const purchaseSuppression = {
  name: 'PURCHASE_SUPPRESSION',
  evaluate(ctx) {
    if (!ctx.purchase) return null;
    return {
      decision: DECISIONS.SUPPRESS,
      reason: `Cart ${ctx.targetCart.cart_id} was converted: purchase completed at ${iso(ctx.purchase.timestamp)}.`,
    };
  },
};

export const optOutSuppression = {
  name: 'OPT_OUT_SUPPRESSION',
  evaluate(ctx) {
    if (!ctx.profile) {
      return {
        decision: DECISIONS.SUPPRESS,
        reason: 'No customer profile found, so promotional consent cannot be confirmed.',
      };
    }
    if (ctx.unsubscribe) {
      return {
        decision: DECISIONS.SUPPRESS,
        reason: `Customer unsubscribed from promotional communication at ${iso(ctx.unsubscribe.timestamp)}.`,
      };
    }
    if (!ctx.profile.promotional_consent) {
      return {
        decision: DECISIONS.SUPPRESS,
        reason: 'Customer has not consented to promotional communication.',
      };
    }
    return null;
  },
};

export const onePerCart = {
  name: 'ONE_FOLLOWUP_PER_CART',
  evaluate(ctx) {
    const existing = ctx.followups.find((f) => f.cart_id === ctx.targetCart.cart_id);
    if (!existing) return null;
    return {
      decision: DECISIONS.SUPPRESS,
      reason: `A follow-up for cart ${ctx.targetCart.cart_id} was already sent at ${iso(existing.at)} (${existing.id}).`,
    };
  },
};

export const replySuppression = {
  name: 'REPLY_SUPPRESSION',
  evaluate(ctx) {
    if (!ctx.replyAfterAbandonment) return null;
    return {
      decision: DECISIONS.SUPPRESS,
      reason: `Customer replied at ${iso(ctx.replyAfterAbandonment.timestamp)}, after the cart was last active, so they are already engaged.`,
    };
  },
};

export const abandonmentWindow = {
  name: 'ABANDONMENT_WINDOW',
  evaluate(ctx) {
    const { abandonmentWindowMs } = ctx.settings;
    const idleMs = ctx.now - ctx.targetCart.last_activity_at;
    if (idleMs >= abandonmentWindowMs) return null;
    const eligibleAt = ctx.targetCart.last_activity_at + abandonmentWindowMs;
    return {
      decision: DECISIONS.DEFER,
      retry_after: iso(eligibleAt),
      reason: `Cart ${ctx.targetCart.cart_id} has only been inactive for ${minutes(idleMs)} minutes; it counts as abandoned after ${minutes(abandonmentWindowMs)} minutes. Ask again after ${iso(eligibleAt)}.`,
    };
  },
};

export const frequencyCap = {
  name: 'FREQUENCY_CAP',
  evaluate(ctx) {
    const { frequencyCapWindowMs, maxFollowupsPerWindow } = ctx.settings;
    const windowStart = ctx.now - frequencyCapWindowMs;
    const recent = ctx.followups.filter((f) => f.at > windowStart);
    if (recent.length < maxFollowupsPerWindow) return null;
    const last = recent[recent.length - 1];
    return {
      decision: DECISIONS.SUPPRESS,
      next_eligible_at: iso(recent[0].at + frequencyCapWindowMs),
      reason: `Customer already received a follow-up at ${iso(last.at)}; the limit is ${maxFollowupsPerWindow} per ${minutes(frequencyCapWindowMs) / 60} hours.`,
    };
  },
};

export const channelSelection = {
  name: 'CHANNEL_SELECTION',
  evaluate(ctx) {
    const { channel, tried } = selectChannel(ctx.profile, ctx.settings);
    ctx.channelCheck = tried;
    if (channel) {
      ctx.selectedChannel = channel;
      return null;
    }
    const detail = tried.map((t) => `${t.channel}: ${t.why}`).join('; ');
    return {
      decision: DECISIONS.SUPPRESS,
      reason: `No eligible channel: the customer has not consented to, or cannot currently be reached on, any outbound channel (${detail}).`,
    };
  },
};

export const DEFAULT_RULES = Object.freeze([
  hasAbandonmentCandidate,
  purchaseSuppression,
  optOutSuppression,
  onePerCart,
  replySuppression,
  abandonmentWindow,
  frequencyCap,
  channelSelection,
]);
