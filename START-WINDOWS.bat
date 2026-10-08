@echo off
title CLYX — Your Digital Universe
where node >nul 2>nul || (echo Install Node.js from https://nodejs.org && pause && exit)
echo Installing dependencies...
npm install --silent
echo Launching CLYX...
npm start
