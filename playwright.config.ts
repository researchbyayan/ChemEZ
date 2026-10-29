import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./frontend/e2e',timeout:30000,use:{baseURL:'http://127.0.0.1:5173',viewport:{width:1320,height:900}},webServer:{command:'npm exec vite -- --host 127.0.0.1',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI}});
