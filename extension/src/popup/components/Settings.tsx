import React, { useState, useEffect } from 'react';
import { Save } from 'lucide-react';

const Settings: React.FC = () => {
  const [autoDetect, setAutoDetect] = useState(true);
  const [interval, setIntervalTime] = useState(1000);
  const [threshold, setThreshold] = useState('Medium');
  const [apiUrl, setApiUrl] = useState('http://localhost:3001');

  useEffect(() => {
    chrome.storage.sync.get(['autoDetect', 'interval', 'threshold', 'apiUrl'], (res) => {
      if (res.autoDetect !== undefined) setAutoDetect(res.autoDetect);
      if (res.interval !== undefined) setIntervalTime(res.interval);
      if (res.threshold !== undefined) setThreshold(res.threshold);
      if (res.apiUrl !== undefined) setApiUrl(res.apiUrl);
    });
  }, []);

  const saveSettings = () => {
    chrome.storage.sync.set({
      autoDetect,
      interval,
      threshold,
      apiUrl
    }, () => {
      // Optional: show saved confirmation
    });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Settings</h2>

      <div className="space-y-4">
        {/* Auto Detect Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Auto Detection</div>
            <div className="text-xs text-gray-400">Continuously scan screen for questions</div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={autoDetect} onChange={(e) => setAutoDetect(e.target.checked)} />
            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
          </label>
        </div>

        {/* API URL */}
        <div>
          <label className="block font-medium mb-1">Backend API URL</label>
          <input 
            type="text" 
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            className="w-full bg-black/30 border border-gray-600 rounded-lg p-2 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Interval Slider */}
        <div>
          <div className="flex justify-between mb-1">
            <label className="font-medium">Scan Interval</label>
            <span className="text-sm text-gray-400">{interval}ms</span>
          </div>
          <input 
            type="range" 
            min="500" max="5000" step="500"
            value={interval}
            onChange={(e) => setIntervalTime(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
        </div>

        {/* Confidence Threshold */}
        <div>
          <label className="block font-medium mb-1">Min Confidence Alert</label>
          <select 
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-full bg-black/30 border border-gray-600 rounded-lg p-2 text-sm focus:outline-none focus:border-blue-500 appearance-none"
          >
            <option value="Any">Any Confidence</option>
            <option value="Medium">Medium & High</option>
            <option value="High">High Only</option>
          </select>
        </div>
      </div>

      <button 
        onClick={saveSettings}
        className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl flex items-center justify-center gap-2 transition-colors font-medium mt-8"
      >
        <Save size={18} /> Save Settings
      </button>
    </div>
  );
};

export default Settings;
