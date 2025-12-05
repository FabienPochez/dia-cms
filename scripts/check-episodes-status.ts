#!/usr/bin/env tsx
import { getPayload } from 'payload';
import config from '../src/payload.config.js';

async function check() {
  const payload = await getPayload({ config });
  const episodeIds = [
    '685e6a53b3ef76e0e25c165e',
    '685e6a56b3ef76e0e25c2155',
    '68826598ba767f41743ca547',
    '68826598ba767f41743ca5a7'
  ];
  
  for (const id of episodeIds) {
    try {
      const episode = await payload.findByID({ collection: 'episodes', id });
      console.log(`\n📁 Episode ${id}:`);
      console.log(`   Title: ${episode.title}`);
      console.log(`   scheduledEnd: ${episode.scheduledEnd}`);
      console.log(`   hasArchiveFile: ${episode.hasArchiveFile}`);
      console.log(`   archiveFilepath: ${episode.archiveFilepath}`);
      console.log(`   libretimeFilepathRelative: ${episode.libretimeFilepathRelative}`);
    } catch (error) {
      console.log(`\n❌ Episode ${id}: Error - ${error.message}`);
    }
  }
  process.exit(0);
}

check();






