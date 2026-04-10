const http = require('https');
const url = 'https://router.project-osrm.org/route/v1/driving/-4.00492,5.35242;-4.02,5.33?overview=full&geometries=geojson&steps=true';
http.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('STATUS:', res.statusCode, 'DATA:', data.substring(0, 300)));
});
