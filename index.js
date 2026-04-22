require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { Pool } = require('pg');

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
async function getStreamers(guildId) {
  const res = await pool.query(
    'SELECT * FROM streamers WHERE guild_id = $1',
    [guildId]
  );
  return res.rows;
}

async function addStreamer(data) {
  await pool.query(
    `INSERT INTO streamers (guild_id, name, channel_id, mention_channel_id, mention_role_id, message)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      data.guildId,
      data.name,
      data.channelId,
      data.mentionChannelId,
      data.mentionRoleId,
      data.message
    ]
  );
}

async function removeStreamer(guildId, name) {
  await pool.query(
    'DELETE FROM streamers WHERE guild_id = $1 AND name = $2',
    [guildId, name]
  );
}

async function updateStreamer(guildId, name, updates) {
  const fields = [];
  const values = [];
  let i = 1;

  for (const key in updates) {
    fields.push(`${key} = $${i++}`);
    values.push(updates[key]);
  }

  if (!fields.length) return;

  values.push(guildId, name);

  await pool.query(
    `UPDATE streamers SET ${fields.join(', ')} WHERE guild_id = $${i++} AND name = $${i}`,
    values
  );
}

async function setDefaultChannel(guildId, channelId) {
  await pool.query(
    `INSERT INTO guild_settings (guild_id, default_channel_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id)
     DO UPDATE SET default_channel_id = EXCLUDED.default_channel_id`,
    [guildId, channelId]
  );
}

async function getDefaultChannel(guildId) {
  const res = await pool.query(
    'SELECT default_channel_id FROM guild_settings WHERE guild_id = $1',
    [guildId]
  );
  return res.rows[0]?.default_channel_id || null;
}

// ===== UTIL =====
function parseTwitchInput(input) {
  input = input.toLowerCase().trim();
  if (input.includes('twitch.tv/')) {
    return input.split('twitch.tv/')[1].split('/')[0];
  }
  return input;
}

function createEmbed(stream, message) {
  return new EmbedBuilder()
    .setTitle(`🔴 ${stream.user_name} is LIVE!`)
    .setURL(`https://twitch.tv/${stream.user_login}`)
    .setDescription(message || `${stream.user_name} is live!`)
    .addFields(
      { name: '🎮 Game', value: stream.game_name || 'Unknown', inline: true },
      { name: '👀 Viewers', value: String(stream.viewer_count), inline: true }
    )
    .setImage(stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720'))
    .setColor(0x9146FF)
    .setTimestamp();
}

// ===== CHECK =====
async function checkStreams() {
  const guilds = client.guilds.cache;

  for (const guild of guilds.values()) {
    const streamers = await getStreamers(guild.id);

    for (const entry of streamers) {
      const stream = await fetchStream(entry.name);

      if (stream && !liveCache[entry.name + guild.id]) {
        liveCache[entry.name + guild.id] = true;

        const channel = await client.channels.fetch(entry.channel_id);

        let content = '';
        if (entry.mention_channel_id) content += `<#${entry.mention_channel_id}> `;
        if (entry.mention_role_id) content += `<@&${entry.mention_role_id}>`;

        const embed = createEmbed(stream, entry.message);

        await channel.send({ content: content || null, embeds: [embed] });
      }

      if (!stream) {
        liveCache[entry.name + guild.id] = false;
      }
    }
  }
}

// ===== COMMANDS =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guildId;
  const raw = interaction.options.getString('name');
  const name = raw ? parseTwitchInput(raw) : null;

  if (interaction.commandName === 'setchannel') {
    const channel = interaction.options.getChannel('channel');
    await setDefaultChannel(guildId, channel.id);
    return interaction.reply(`✅ Default channel set to ${channel}`);
  }

  if (interaction.commandName === 'addstreamer') {
    let sendChannel = interaction.options.getChannel('send_channel');

    if (!sendChannel) {
      const defaultChannel = await getDefaultChannel(guildId);
      if (!defaultChannel) {
        return interaction.reply({
          content: '❌ Use /setchannel or provide a channel.',
          ephemeral: true
        });
      }
      sendChannel = { id: defaultChannel };
    }

    await addStreamer({
      guildId,
      name,
      channelId: sendChannel.id,
      mentionChannelId: interaction.options.getChannel('mention_channel')?.id || null,
      mentionRoleId: interaction.options.getRole('mention_role')?.id || null,
      message: interaction.options.getString('message')
    });

    return interaction.reply(`✅ Added ${name}`);
  }

  if (interaction.commandName === 'removestreamer') {
    await removeStreamer(guildId, name);
    return interaction.reply(`🗑️ Removed ${name}`);
  }

  if (interaction.commandName === 'editstreamer') {
    const updates = {};

    if (interaction.options.getChannel('send_channel'))
      updates.channel_id = interaction.options.getChannel('send_channel').id;

    if (interaction.options.getChannel('mention_channel') !== null)
      updates.mention_channel_id = interaction.options.getChannel('mention_channel')?.id || null;

    if (interaction.options.getRole('mention_role') !== null)
      updates.mention_role_id = interaction.options.getRole('mention_role')?.id || null;

    if (interaction.options.getString('message') !== null)
      updates.message = interaction.options.getString('message');

    await updateStreamer(guildId, name, updates);
    return interaction.reply(`✏️ Updated ${name}`);
  }

  if (interaction.commandName === 'liststreamers') {
    const streamers = await getStreamers(guildId);
    const list = streamers.map(s => `• ${s.name}`).join('\n') || 'None';

    return interaction.reply({ content: list, ephemeral: true });
  }
});

// ===== START =====
client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  await getTwitchToken();
  setInterval(checkStreams, process.env.CHECK_INTERVAL || 60000);
});

client.login(process.env.DISCORD_TOKEN);
