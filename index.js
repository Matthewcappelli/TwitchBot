require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { Pool } = require('pg');

// ===== SETUP =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let twitchToken = null;
let liveCache = {};

// ===== TWITCH =====
async function getTwitchToken() {
  const res = await axios.post(`https://id.twitch.tv/oauth2/token`, null, {
    params: {
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials'
    }
  });

  twitchToken = res.data.access_token;
  console.log('✅ Twitch connected');
}

async function fetchStream(name) {
  try {
    const res = await axios.get(`https://api.twitch.tv/helix/streams`, {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${twitchToken}`
      },
      params: { user_login: name }
    });

    return res.data.data[0] || null;
  } catch {
    return null;
  }
}

// ===== DATABASE =====
async function getStreamers() {
  const res = await pool.query('SELECT * FROM streamers');
  return res.rows;
}

async function addStreamer(data) {
  await pool.query(
    `INSERT INTO streamers (name, channel_id, mention_channel_id, mention_role_id, message)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      data.name,
      data.channelId,
      data.mentionChannelId,
      data.mentionRoleId,
      data.message
    ]
  );
}

async function removeStreamer(name) {
  await pool.query('DELETE FROM streamers WHERE name = $1', [name]);
}

async function updateStreamer(name, updates) {
  const fields = [];
  const values = [];
  let i = 1;

  for (const key in updates) {
    fields.push(`${key} = $${i++}`);
    values.push(updates[key]);
  }

  if (!fields.length) return;

  values.push(name);

  await pool.query(
    `UPDATE streamers SET ${fields.join(', ')} WHERE name = $${i}`,
    values
  );
}

// ===== UTIL =====
function parseTwitchInput(input) {
  input = input.toLowerCase().trim();
  if (input.includes('twitch.tv/')) {
    return input.split('twitch.tv/')[1].split('/')[0];
  }
  return input;
}

function formatMessage(template, data) {
  return (template || '{streamer} is live! {url}')
    .replace(/{streamer}/g, data.user_name)
    .replace(/{title}/g, data.title)
    .replace(/{game}/g, data.game_name)
    .replace(/{url}/g, `https://twitch.tv/${data.user_login}`);
}

function createEmbed(stream, message) {
  return new EmbedBuilder()
    .setTitle(`🔴 ${stream.user_name} is LIVE!`)
    .setURL(`https://twitch.tv/${stream.user_login}`)
    .setDescription(formatMessage(message, stream))
    .addFields(
      { name: '🎮 Game', value: stream.game_name || 'Unknown', inline: true },
      { name: '👀 Viewers', value: String(stream.viewer_count), inline: true }
    )
    .setImage(
      stream.thumbnail_url
        .replace('{width}', '1280')
        .replace('{height}', '720')
    )
    .setColor(0x9146FF)
    .setTimestamp();
}

// ===== STREAM CHECK =====
async function checkStreams() {
  const streamers = await getStreamers();

  for (const entry of streamers) {
    const stream = await fetchStream(entry.name);

    if (stream && !liveCache[entry.name]) {
      liveCache[entry.name] = true;

      const channel = await client.channels.fetch(entry.channel_id);

      let content = '';
      if (entry.mention_channel_id) content += `<#${entry.mention_channel_id}> `;
      if (entry.mention_role_id) content += `<@&${entry.mention_role_id}>`;

      const embed = createEmbed(stream, entry.message);

      await channel.send({
        content: content || null,
        embeds: [embed]
      });

      console.log(`📢 ${entry.name} went live`);
    }

    if (!stream) {
      liveCache[entry.name] = false;
    }
  }
}

// ===== COMMANDS =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const raw = interaction.options.getString('name');
  const name = raw ? parseTwitchInput(raw) : null;

  // ADD
  if (interaction.commandName === 'addstreamer') {
    const existing = (await getStreamers()).find(s => s.name === name);

    if (existing) {
      return interaction.reply({ content: 'Already exists', ephemeral: true });
    }

    await addStreamer({
      name,
      channelId: interaction.options.getChannel('send_channel').id,
      mentionChannelId: interaction.options.getChannel('mention_channel')?.id || null,
      mentionRoleId: interaction.options.getRole('mention_role')?.id || null,
      message: interaction.options.getString('message')
    });

    return interaction.reply(`Added ${name}`);
  }

  // REMOVE
  if (interaction.commandName === 'removestreamer') {
    await removeStreamer(name);
    return interaction.reply(`Removed ${name}`);
  }

  // EDIT
  if (interaction.commandName === 'editstreamer') {
    const updates = {};

    const sendChannel = interaction.options.getChannel('send_channel');
    const mentionChannel = interaction.options.getChannel('mention_channel');
    const mentionRole = interaction.options.getRole('mention_role');
    const message = interaction.options.getString('message');

    if (sendChannel) updates.channel_id = sendChannel.id;
    if (mentionChannel !== null) updates.mention_channel_id = mentionChannel?.id || null;
    if (mentionRole !== null) updates.mention_role_id = mentionRole?.id || null;
    if (message !== null) updates.message = message;

    await updateStreamer(name, updates);

    return interaction.reply(`Updated ${name}`);
  }

  // LIST
  if (interaction.commandName === 'liststreamers') {
    const streamers = await getStreamers();
    const list = streamers.map(s => `• ${s.name}`).join('\n') || 'None';

    return interaction.reply({
      content: list,
      ephemeral: true
    });
  }
});

// ===== START =====
client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  await getTwitchToken();
  setInterval(checkStreams, process.env.CHECK_INTERVAL || 60000);
});

client.login(process.env.DISCORD_TOKEN);