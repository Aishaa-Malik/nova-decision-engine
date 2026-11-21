export const SEED_PROFILES = [
  {
    customer_id: 'CUST-101',
    promotional_consent: true,
    consented_channels: ['WHATSAPP', 'EMAIL'],
    available_channels: ['WHATSAPP', 'EMAIL'],
    preferred_channel: 'WHATSAPP',
  },
  {
    customer_id: 'CUST-102',
    promotional_consent: true,
    consented_channels: ['EMAIL'],
    available_channels: ['WHATSAPP', 'EMAIL'],
    preferred_channel: 'EMAIL',
  },
  {
    customer_id: 'CUST-103',
    promotional_consent: true,
    consented_channels: ['WHATSAPP', 'EMAIL'],
    available_channels: ['EMAIL'],
    preferred_channel: 'WHATSAPP',
  },
  {
    customer_id: 'CUST-104',
    promotional_consent: true,
    consented_channels: ['WHATSAPP'],
    available_channels: ['EMAIL'],
    preferred_channel: 'WHATSAPP',
  },
  {
    customer_id: 'CUST-105',
    promotional_consent: false,
    consented_channels: [],
    available_channels: ['WHATSAPP', 'EMAIL'],
    preferred_channel: null,
  },
];
