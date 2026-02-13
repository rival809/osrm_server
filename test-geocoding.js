const axios = require('axios');

/**
 * Test script untuk Nominatim Geocoding
 * 
 * Usage:
 *   node test-geocoding.js
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:81';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function testReverseGeocoding() {
  log('\n[TEST 1] Reverse Geocoding - Get location name from coordinates', colors.cyan);
  log('='.repeat(60), colors.cyan);
  
  const testCases = [
    { lat: -6.9175, lon: 107.6191, name: 'Bandung City Center' },
    { lat: -6.8722, lon: 107.5419, name: 'Cimahi' },
    { lat: -7.7956, lon: 110.3695, name: 'Yogyakarta' },
    { lat: -6.2088, lon: 106.8456, name: 'Jakarta' },
  ];

  for (const testCase of testCases) {
    try {
      log(`\n📍 Testing: ${testCase.name} (${testCase.lat}, ${testCase.lon})`, colors.yellow);
      
      const startTime = Date.now();
      const response = await axios.get(`${BASE_URL}/geocode/reverse`, {
        params: {
          lat: testCase.lat,
          lon: testCase.lon
        }
      });
      const responseTime = Date.now() - startTime;

      if (response.data.success) {
        log(`✅ SUCCESS (${responseTime}ms)`, colors.green);
        log(`   Location: ${response.data.location.display_name}`, colors.green);
        log(`   Name: ${response.data.location.name}`, colors.green);
        log(`   City: ${response.data.address.city || response.data.address.town || 'N/A'}`, colors.green);
        log(`   State: ${response.data.address.state || 'N/A'}`, colors.green);
      } else {
        log(`❌ FAILED: ${response.data.error}`, colors.red);
      }
    } catch (error) {
      log(`❌ ERROR: ${error.message}`, colors.red);
      if (error.response) {
        log(`   Status: ${error.response.status}`, colors.red);
        log(`   Data: ${JSON.stringify(error.response.data)}`, colors.red);
      }
    }
  }
}

async function testForwardGeocoding() {
  log('\n\n[TEST 2] Forward Geocoding - Search locations by name', colors.cyan);
  log('='.repeat(60), colors.cyan);
  
  const queries = [
    'Bandung',
    'Gedung Sate',
    'Cimahi',
    'Alun-alun Bandung',
    'Jalan Asia Afrika'
  ];

  for (const query of queries) {
    try {
      log(`\n🔍 Searching: "${query}"`, colors.yellow);
      
      const startTime = Date.now();
      const response = await axios.get(`${BASE_URL}/geocode/search`, {
        params: {
          q: query,
          limit: 3
        }
      });
      const responseTime = Date.now() - startTime;

      if (response.data.success) {
        log(`✅ SUCCESS (${responseTime}ms) - Found ${response.data.count} results`, colors.green);
        
        response.data.results.slice(0, 3).forEach((result, index) => {
          log(`   ${index + 1}. ${result.display_name}`, colors.green);
          log(`      Coordinates: ${result.coordinates.lat}, ${result.coordinates.lon}`, colors.green);
        });
      } else {
        log(`❌ FAILED: ${response.data.error}`, colors.red);
      }
    } catch (error) {
      log(`❌ ERROR: ${error.message}`, colors.red);
      if (error.response) {
        log(`   Status: ${error.response.status}`, colors.red);
      }
    }
  }
}

async function testHealthCheck() {
  log('\n\n[TEST 3] Health Check - Check if all services are running', colors.cyan);
  log('='.repeat(60), colors.cyan);
  
  try {
    const response = await axios.get(`${BASE_URL}/health`);
    
    log('\n✅ Service Health:', colors.green);
    log(`   Status: ${response.data.status}`, colors.green);
    log(`   Service: ${response.data.service}`, colors.green);
    log(`   Region: ${response.data.region}`, colors.green);
    log(`   OSRM Backend: ${response.data.osrmBackend}`, colors.green);
    log(`   Tileserver: ${response.data.tileServer} (${response.data.tileserverStatus})`, colors.green);
    log(`   Nominatim: ${response.data.nominatim} (${response.data.nominatimStatus})`, colors.green);
    log(`   Memory: ${response.data.memory.current} (${response.data.memory.percent}%)`, colors.green);
    
    if (response.data.nominatimStatus !== 'ok') {
      log('\n⚠️  WARNING: Nominatim is not ready!', colors.yellow);
      log('   This is normal during initial import (2-4 hours)', colors.yellow);
      log('   Monitor: docker-compose logs -f nominatim', colors.yellow);
    }
  } catch (error) {
    log(`❌ ERROR: ${error.message}`, colors.red);
  }
}

async function testDirectNominatim() {
  log('\n\n[TEST 4] Direct Nominatim API - Test raw Nominatim endpoint', colors.cyan);
  log('='.repeat(60), colors.cyan);
  
  const NOMINATIM_URL = 'http://localhost:5002';
  
  try {
    log('\n📡 Testing direct Nominatim connection...', colors.yellow);
    
    // Test status
    try {
      const statusResponse = await axios.get(`${NOMINATIM_URL}/status.php?format=json`, {
        timeout: 5000
      });
      log(`✅ Nominatim Status: ${JSON.stringify(statusResponse.data)}`, colors.green);
    } catch (error) {
      log(`❌ Nominatim not ready: ${error.message}`, colors.red);
      log('   Nominatim might still be importing data', colors.yellow);
      log('   Check: docker-compose logs nominatim', colors.yellow);
      return;
    }
    
    // Test reverse geocoding
    const reverseResponse = await axios.get(`${NOMINATIM_URL}/reverse`, {
      params: {
        lat: -6.9175,
        lon: 107.6191,
        format: 'json'
      }
    });
    
    log('\n✅ Direct Nominatim Reverse Geocoding:', colors.green);
    log(`   ${reverseResponse.data.display_name}`, colors.green);
    
  } catch (error) {
    log(`❌ ERROR: ${error.message}`, colors.red);
    if (error.code === 'ECONNREFUSED') {
      log('   Nominatim container might not be running', colors.yellow);
      log('   Run: docker-compose up -d nominatim', colors.yellow);
    }
  }
}

async function runAllTests() {
  log('\n' + '='.repeat(60), colors.cyan);
  log('  NOMINATIM GEOCODING TEST SUITE', colors.cyan);
  log('='.repeat(60), colors.cyan);
  log(`  Base URL: ${BASE_URL}`, colors.cyan);
  log('='.repeat(60), colors.cyan);

  await testHealthCheck();
  await testDirectNominatim();
  await testReverseGeocoding();
  await testForwardGeocoding();

  log('\n\n' + '='.repeat(60), colors.cyan);
  log('  ALL TESTS COMPLETED', colors.cyan);
  log('='.repeat(60), colors.cyan);
  log('\nNote: If geocoding tests fail, Nominatim might still be importing data.', colors.yellow);
  log('This process takes 2-4 hours for Java Island.', colors.yellow);
  log('Monitor: docker-compose logs -f nominatim\n', colors.yellow);
}

// Run tests
runAllTests().catch(error => {
  log(`\n❌ FATAL ERROR: ${error.message}`, colors.red);
  process.exit(1);
});
