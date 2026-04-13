---
created: 2026-04-13T21:38:58Z
title: Evaluate continuous weather sampling
area: general
files:
  - frontend/src/main.ts:1023-1228
  - frontend/src/utils/WeatherAPI.ts:46-149
  - frontend/src/utils/WeatherAPI.ts:232-372
  - frontend/src/utils/WeatherCache.ts:89-168
---

## Problem

The current auto-rho weather integration fetches one weather sample for the trim region using the average GPS location and the middle timestamp rounded to the nearest 15-minute slot. That is simple, but it loses variation across long rides or courses that move through different locations and weather windows. The app already has support for per-sample environmental arrays in the activity model and can calculate per-point air density when temperature / humidity / pressure arrays exist, so there may be a path to better temporal and spatial resolution than a single scalar weather snapshot.

## Solution

Investigate a continuous weather pipeline that samples route weather at quarter-hour boundaries (`:00`, `:15`, `:30`, `:45`) using representative GPS positions for each window, caches those API responses, and interpolates temperature / pressure / wind (and any other useful weather fields) across the full ride to produce higher-resolution series. Compare whether this should feed directly into the existing per-sample air-density path or remain an optional enhancement over the current single-sample auto-rho workflow. Make sure the cache key and query model can support multiple points per activity without breaking the current IndexedDB weather cache behavior.