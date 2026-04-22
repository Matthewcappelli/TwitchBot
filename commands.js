require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('addstreamer')
    .setDescription('Add a Twitch streamer')
    .addStringOption(opt =>
      opt.setName('name').setDescription('Twitch username or link').setRequired(true))
    .addChannelOption(opt =>
      opt.setName('send_channel').setDescription('Channel to send alerts').setRequired(true))
    .addChannelOption(opt =>
      opt.setName('mention_channel').setDescription('Channel to mention').setRequired(false))
    .addRoleOption(opt =>
      opt.setName('mention_role').setDescription('Role to ping').setRequired(false))
    .addStringOption(opt =>
      opt.setName('message').setDescription('Custom message').setRequired(false)),

  new SlashCommandBuilder()
    .setName('removestreamer')
    .setDescription('Remove a streamer')
    .addStringOption(opt =>
      opt.setName('name').setDescription('Twitch username or link').setRequired(true)),

  new SlashCommandBuilder()
    .setName('editstreamer')
    .setDescription('Edit a streamer')
    .addStringOption(opt =>
      opt.setName('name').setDescription('Streamer name').setRequired(true))
    .addChannelOption(opt =>
      opt.setName('send_channel').setDescription('New send channel').setRequired(false))
    .addChannelOption(opt =>
      opt.setName('mention_channel').setDescription('New mention channel').setRequired(false))
    .addRoleOption(opt =>
      opt.setName('mention_role').setDescription('New mention role').setRequired(false))
    .addStringOption(opt =>
      opt.setName('message').setDescription('New message').setRequired(false)),

  new SlashCommandBuilder()
    .setName('liststreamers')
    .setDescription('List all streamers')
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );

  console.log('✅ Commands registered');
})();