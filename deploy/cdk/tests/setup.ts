/** Settings come from each test's context, whatever the shell or CI exports. */
const DEPLOY_ENV_VARS = ['CLOUD_URL', 'SITE_DESIRED_COUNT', 'SITE_IMAGE_TAG', 'SITE_ASSET_BASE_URL', 'SITE_OAUTH_ISSUER', 'SITE_ALARM_EMAIL'];

for (const name of DEPLOY_ENV_VARS) delete process.env[name];
