// Unit tests never reach a network: every backend address points at nothing.
process.env.CLOUD_URL = 'http://cloud.invalid';
process.env.CLOUD_API_KEY = 'lt_bot_test';
process.env.CLOUD_BOT_ID = 'bot-test';
process.env.POSTGRES_HOST = 'postgres.invalid';
delete process.env.NATS_URL;
delete process.env.DATABASE_URL;
