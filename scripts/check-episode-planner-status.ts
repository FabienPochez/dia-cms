#!/usr/bin/env tsx
import { getPayload } from 'payload';
import config from '../src/payload.config.js';

async function check() {
  const payload = await getPayload({ config });
  const episodeId = '68826598ba767f41743ca55b';
  
  try {
    const episode = await payload.findByID({ 
      collection: 'episodes', 
      id: episodeId,
      depth: 1 
    });
    
    console.log(`\n📁 Episode ${episodeId}:`);
    console.log(`   Title: ${episode.title}`);
    console.log(`   publishedStatus: ${episode.publishedStatus}`);
    console.log(`   libretimeTrackId: ${episode.libretimeTrackId || '(missing)'}`);
    console.log(`   libretimeFilepathRelative: ${episode.libretimeFilepathRelative || '(missing)'}`);
    console.log(`   scheduledAt: ${episode.scheduledAt || '(not scheduled)'}`);
    console.log(`   scheduledEnd: ${episode.scheduledEnd || '(not scheduled)'}`);
    console.log(`   airStatus: ${episode.airStatus}`);
    console.log(`   isLive: ${episode.isLive || false}`);
    
    // Check LT-ready status (matching useUnscheduledEpisodes.ts filter)
    const hasTrackId = episode.libretimeTrackId?.trim();
    const hasFilepath = episode.libretimeFilepathRelative?.trim();
    const isPublished = episode.publishedStatus === 'published';
    
    console.log(`\n🔍 Planner Eligibility Check (from useUnscheduledEpisodes.ts):`);
    console.log(`   ✓ publishedStatus = 'published': ${isPublished ? '✅ YES' : '❌ NO'}`);
    console.log(`   ✓ libretimeTrackId exists and not empty: ${hasTrackId ? '✅ YES' : '❌ NO'}`);
    console.log(`   ✓ libretimeFilepathRelative exists and not empty: ${hasFilepath ? '✅ YES' : '❌ NO'}`);
    
    const isEligible = isPublished && hasTrackId && hasFilepath;
    console.log(`\n${isEligible ? '✅' : '❌'} Episode is ${isEligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'} for planner`);
    
    if (!isEligible) {
      console.log(`\n💡 Missing requirements:`);
      if (!isPublished) {
        console.log(`   - publishedStatus must be 'published' (currently: '${episode.publishedStatus}')`);
      }
      if (!hasTrackId) {
        console.log(`   - libretimeTrackId is missing or empty`);
      }
      if (!hasFilepath) {
        console.log(`   - libretimeFilepathRelative is missing or empty`);
      }
    } else {
      // Check if it's already scheduled (would appear in scheduled view, not unscheduled)
      if (episode.scheduledAt) {
        console.log(`\n⚠️  Episode is already scheduled (${episode.scheduledAt}), so it won't appear in the unscheduled palette`);
      }
    }
    
  } catch (error: any) {
    console.log(`\n❌ Episode ${episodeId}: Error - ${error.message}`);
  }
  
  process.exit(0);
}

check();
