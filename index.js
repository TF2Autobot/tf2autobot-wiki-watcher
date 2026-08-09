import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

import fs from 'fs';
const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url)));
process.env.WATCHER_VERSION = pkg.version;

import express from 'express';
import crypto from 'crypto';

const app = express();
const port = process.env.PORT || 3000;

// Get from Github repository webhook
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
// Generate secret in terminal with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// And paste it while creating webhook on Github
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
// Private custom endpoint (/webhook/wiki/<private_endpoint>)
const PRIVATE_ENDPOINT = process.env.PRIVATE_ENDPOINT;
const WEBHOOK_USERNAME = process.env.WEBHOOK_USERNAME;
const WEBHOOK_AVATAR_URL = process.env.WEBHOOK_AVATAR_URL;

if (!DISCORD_WEBHOOK_URL) {
    console.error('FATAL: DISCORD_WEBHOOK_URL is missing from environment variables.');
    process.exit(1);
}

app.use(express.static('./public'))
    .use(
        express.json({
            verify: (req, res, buf) => {
                req.rawBody = buf;
            }
        })
    )
    .use((req, res, next) => {
        console.info(`${req.method} request to ${req.url}`);
        next();
    });

app.post(`/webhook/wiki${PRIVATE_ENDPOINT ? `/${PRIVATE_ENDPOINT}` : ''}`, async (req, res) => {
    if (GITHUB_WEBHOOK_SECRET) {
        const signature = req.headers['x-hub-signature-256'] || '';
        const signatureBuffer = Buffer.from(signature);
        const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
        const digest = 'sha256=' + hmac.update(req.rawBody || '').digest('hex');
        const digestBuffer = Buffer.from(digest);

        if (signatureBuffer.length !== digestBuffer.length || !crypto.timingSafeEqual(signatureBuffer, digestBuffer)) {
            console.warn('Unauthorized webhook attempt rejected.');
            return res.status(401).send('Unauthorized: Signature mismatch');
        }
    }

    const event = req.headers['x-github-event'];
    if (event === 'ping') {
        return res.status(200).send('Pong! Webhook is active and configured correctly.');
    }
    if (event !== 'gollum') {
        return res.status(200).send('Ignored event type. Only listening for gollum.');
    }

    const payload = req.body;
    if (!payload || !Array.isArray(payload.pages) || !payload.sender || !payload.repository) {
        return res.status(400).send('Bad Request: Malformed payload');
    }

    const sender = payload.sender.login;
    const repoName = payload.repository.full_name;

    const changes = {
        created: [],
        edited: []
    };

    payload.pages.forEach(page => {
        changes[page.action === 'created' ? 'created' : 'edited'].push(
            `[${page.title}](${page.html_url})\n` +
                `📜 Summary: ${page.summary || '*No summary provided*'}\n` +
                `#️⃣ Commit: \`${page.sha.substring(0, 7)}\``
        );
    });

    const embeds = [];

    ['created', 'edited'].forEach(action => {
        if (changes[action].length > 0) {
            const embed = {
                title: `Wiki Page${changes[action].length > 1 ? 's' : ''} ${action.charAt(0).toUpperCase() + action.slice(1)}`,
                color: action === 'created' ? 0x28a745 : 0x0366d6,
                author: {
                    name: sender,
                    icon_url: payload.sender.avatar_url,
                    url: payload.sender.html_url
                },
                description: '- ' + changes[action].join('\n- ')
            };
            embeds.push(embed);
        }
    });

    if (embeds.length > 0) {
        const lastEmbed = embeds[embeds.length - 1]; // Get last item safely
        lastEmbed.footer = {
            text: `v${process.env.WATCHER_VERSION}`
        };
        lastEmbed.timestamp = new Date().toISOString();
    }

    const webhook = {
        content: `📝 [${repoName}](${payload.repository.html_url}/wiki)`,
        embeds: embeds
    };

    if (WEBHOOK_USERNAME) webhook.username = WEBHOOK_USERNAME;
    if (WEBHOOK_AVATAR_URL) webhook.avatar_url = WEBHOOK_AVATAR_URL;

    try {
        const response = await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webhook)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Discord API Error:', response.statusText, errorText);
            return res.status(500).send('Failed to relay to Discord');
        }

        res.status(200).send('Successfully delivered to Discord');
    } catch (error) {
        console.error('Network Error:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(port, () => {
    console.log(`Wiki Webhook Relayer running on port ${port}`);
});
