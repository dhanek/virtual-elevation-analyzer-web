//! From a Repeats selection to the Kalman fit's design (TODO J6, spec §2,
//! §3.2): every leg on one road axis, the deterministic pre-masks, clean
//! stretches, thinning to the grid step, and the fit itself behind one JSON
//! entry point for WASM and the CLI.

use crate::kalman_fit::{
    fitted_residuals, kalman_fit, loop_cut, session_comparison, AirSpeed, Design, FitError, KalmanOptions,
    KalmanResult, LegDesign, StepAt, Warning,
};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

const G: f64 = 9.807;
/// A route whose ends are this close (m) is a closed loop…
const LOOP_CLOSURE_M: f64 = 30.0;
/// …if it is at least this long (m).
const LOOP_MIN_M: f64 = 300.0;
/// A sample further than this (m) from the route is off it.
const OFF_ROUTE_M: f64 = 50.0;
/// Map matching searches this far (m) along the route from the last match.
const MATCH_WINDOW_M: f64 = 150.0;

/// One leg of the selection, sample by sample over its window. Every
/// series has one value per sample; `lat`/`lon` may be empty (no GPS).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegInput {
    pub label: String,
    /// Which ride the leg comes from (B9).
    pub session: usize,
    pub timestamps: Vec<f64>,
    pub power: Vec<f64>,
    pub speed: Vec<f64>,
    pub air_speed: Vec<f64>,
    /// Mean air density over the leg (kg/m³), for the braking rule.
    pub rho: f64,
    /// Distance ridden, rebased to 0 at the window start (m).
    pub distance: Vec<f64>,
    pub lat: Vec<f64>,
    pub lon: Vec<f64>,
    /// Reference elevation, rebased to 0 (m).
    pub elevation: Vec<f64>,
    /// VE at CdA = 0 and Crr = 0, rebased, minus `elevation` (m).
    pub y: Vec<f64>,
    /// One column per `SelectionInput::names` entry, as `y`.
    pub columns: Vec<Vec<f64>>,
}

/// The rider and the current slider values: what the braking rule's
/// coasting physics uses.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Physics {
    pub mass: f64,
    pub eta: f64,
    pub cda: f64,
    pub crr: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SelectionOptions {
    /// Observations along a stretch at least this far apart (m).
    pub grid_m: f64,
    /// "measured", "modelled" or "groundSpeed".
    pub air_speed: String,
    pub fixed_cda: Option<f64>,
    pub jumps: bool,
}

impl Default for SelectionOptions {
    fn default() -> Self {
        SelectionOptions {
            grid_m: 5.0,
            air_speed: "measured".into(),
            fixed_cda: None,
            jumps: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionInput {
    /// Shared parameter names: "CdA", then the Crr groups.
    pub names: Vec<String>,
    pub legs: Vec<LegInput>,
    pub physics: Physics,
    #[serde(default)]
    pub options: SelectionOptions,
}

/// A polyline in local metres (equirectangular about its first point) with
/// its cumulative length: the road axis every leg is mapped onto.
pub struct Route {
    lat0: f64,
    lon0: f64,
    kx: f64,
    xy: Vec<(f64, f64)>,
    s: Vec<f64>,
    pub length: f64,
    /// The route ends where it starts: positions wrap at `length`.
    pub closed: bool,
}

impl Route {
    /// None without two finite fixes.
    pub fn new(lat: &[f64], lon: &[f64]) -> Option<Route> {
        let fixes: Vec<(f64, f64)> = lat
            .iter()
            .zip(lon)
            .filter(|(a, b)| a.is_finite() && b.is_finite() && !(**a == 0.0 && **b == 0.0))
            .map(|(a, b)| (*a, *b))
            .collect();
        if fixes.len() < 2 {
            return None;
        }
        let (lat0, lon0) = fixes[0];
        let kx = 111_320.0 * lat0.to_radians().cos();
        let mut route = Route {
            lat0,
            lon0,
            kx,
            xy: Vec::with_capacity(fixes.len()),
            s: Vec::with_capacity(fixes.len()),
            length: 0.0,
            closed: false,
        };
        for &(a, b) in &fixes {
            let p = route.local(a, b);
            if let Some(&last) = route.xy.last() {
                let step = dist(last, p);
                if step < 1e-6 {
                    continue;
                }
                route.length += step;
            }
            route.xy.push(p);
            route.s.push(route.length);
        }
        if route.xy.len() < 2 {
            return None;
        }
        route.closed = route.length >= LOOP_MIN_M && dist(route.xy[0], *route.xy.last().unwrap()) < LOOP_CLOSURE_M;
        Some(route)
    }

    fn local(&self, lat: f64, lon: f64) -> (f64, f64) {
        ((lon - self.lon0) * self.kx, (lat - self.lat0) * 111_320.0)
    }

    /// Projection of `p` onto segment `i`: (position along the route, distance).
    fn project(&self, i: usize, p: (f64, f64)) -> (f64, f64) {
        let (a, b) = (self.xy[i], self.xy[i + 1]);
        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
        let len2 = dx * dx + dy * dy;
        let t = (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / len2).clamp(0.0, 1.0);
        let q = (a.0 + t * dx, a.1 + t * dy);
        (self.s[i] + t * len2.sqrt(), dist(p, q))
    }

    /// Each fix's position along the route (m), NaN where it has no fix or
    /// lies more than `OFF_ROUTE_M` off it. After the first match the search
    /// stays within `MATCH_WINDOW_M` of the previous one (wrapping on a
    /// closed loop), so a road that passes close to itself is not confused.
    pub fn positions(&self, lat: &[f64], lon: &[f64]) -> Vec<f64> {
        let segments = self.xy.len() - 1;
        let mut out = Vec::with_capacity(lat.len());
        let mut previous: Option<f64> = None;
        for (a, b) in lat.iter().zip(lon) {
            if !(a.is_finite() && b.is_finite()) || (*a == 0.0 && *b == 0.0) {
                out.push(f64::NAN);
                continue;
            }
            let p = self.local(*a, *b);
            let near = |s: f64| -> bool {
                previous.map_or(true, |prev| {
                    let mut gap = (s - prev).abs();
                    if self.closed {
                        gap = gap.min(self.length - gap);
                    }
                    gap <= MATCH_WINDOW_M
                })
            };
            let search = |windowed: bool| -> Option<(f64, f64)> {
                (0..segments)
                    .filter(|&i| {
                        !windowed || near(self.s[i]) || near(self.s[i + 1])
                    })
                    .map(|i| self.project(i, p))
                    .min_by(|x, y| x.1.partial_cmp(&y.1).unwrap())
            };
            let best = search(true)
                .filter(|m| m.1 <= OFF_ROUTE_M)
                .or_else(|| search(false).filter(|m| m.1 <= OFF_ROUTE_M));
            match best {
                Some((s, _)) => {
                    previous = Some(s);
                    out.push(s);
                }
                None => out.push(f64::NAN),
            }
        }
        out
    }
}

fn dist(a: (f64, f64), b: (f64, f64)) -> f64 {
    ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt()
}

/// The deterministic pre-masks (spec §3.2), true where a sample is kept:
///
/// - lap-button / leg ends: the first and last 20 m;
/// - braking: over any 3 s the speed drops more than coasting would allow
///   (no power; drag, rolling and the reference climb at the given CdA and
///   Crr) by more than 0.4 m/s — masked from 3 s before to 2 s after;
/// - corners: the heading turns more than 45° within ±20 m — masked 40 m
///   before to 80 m after (corner exits carry the larger bump, B5).
///
/// Samples whose y or columns are not finite are dropped too.
pub fn premask(leg: &LegInput, physics: &Physics) -> Vec<bool> {
    let n = leg.distance.len();
    let d = &leg.distance;
    let mut keep: Vec<bool> = (0..n)
        .map(|i| {
            leg.y.get(i).is_some_and(|v| v.is_finite())
                && leg.columns.iter().all(|c| c.get(i).is_some_and(|v| v.is_finite()))
                && d[i].is_finite()
        })
        .collect();
    if n == 0 {
        return keep;
    }
    let (first, last) = (d[0], d[n - 1]);
    for i in 0..n {
        if d[i] < first + 20.0 || d[i] > last - 20.0 {
            keep[i] = false;
        }
    }

    // Braking: observed speed change against coasting.
    let t = &leg.timestamps;
    let mut shortfall = vec![0.0; n];
    for i in 1..n.min(t.len()).min(leg.speed.len()) {
        let dt = t[i] - t[i - 1];
        if !(dt > 0.0 && dt < 10.0) {
            continue;
        }
        let v = 0.5 * (leg.speed[i] + leg.speed[i - 1]);
        let va = leg
            .air_speed
            .get(i)
            .zip(leg.air_speed.get(i - 1))
            .map_or(v, |(a, b)| 0.5 * (a + b));
        let climb = leg.elevation.get(i).zip(leg.elevation.get(i - 1)).map_or(0.0, |(a, b)| a - b);
        let m = physics.mass;
        let coast = (-0.5 * leg.rho * physics.cda * va * va * v * dt - physics.crr * m * G * v * dt - m * G * climb)
            / (m * v.max(1.0));
        let observed = leg.speed[i] - leg.speed[i - 1];
        if (coast - observed).is_finite() {
            shortfall[i] = coast - observed;
        }
    }
    let mut braking = Vec::new();
    for i in 1..n.min(t.len()) {
        let sum: f64 = (0..=i).rev().take_while(|&j| t[i] - t[j] < 3.0).map(|j| shortfall[j]).sum();
        if sum > 0.4 {
            braking.push(t[i]);
        }
    }
    for &tb in &braking {
        for i in 0..n.min(t.len()) {
            if t[i] >= tb - 3.0 && t[i] <= tb + 2.0 {
                keep[i] = false;
            }
        }
    }

    // Corners: heading change over ±20 m of distance.
    if leg.lat.len() == n && leg.lon.len() == n {
        if let Some(route) = Route::new(&leg.lat, &leg.lon) {
            let xy: Vec<Option<(f64, f64)>> = leg
                .lat
                .iter()
                .zip(&leg.lon)
                .map(|(a, b)| (a.is_finite() && b.is_finite() && !(*a == 0.0 && *b == 0.0)).then(|| route.local(*a, *b)))
                .collect();
            let at = |target: f64| -> Option<(f64, f64)> {
                let j = d.partition_point(|&x| x < target);
                if j == 0 || j >= n {
                    return None;
                }
                let (p, q) = (xy[j - 1]?, xy[j]?);
                let span = d[j] - d[j - 1];
                let f = if span > 0.0 { (target - d[j - 1]) / span } else { 0.0 };
                Some((p.0 + f * (q.0 - p.0), p.1 + f * (q.1 - p.1)))
            };
            let mut corners = Vec::new();
            for i in 0..n {
                let (Some(here), Some(before), Some(after)) = (xy[i], at(d[i] - 20.0), at(d[i] + 20.0)) else {
                    continue;
                };
                let b1 = (here.1 - before.1).atan2(here.0 - before.0);
                let b2 = (after.1 - here.1).atan2(after.0 - here.0);
                let mut turn = (b2 - b1).abs();
                if turn > std::f64::consts::PI {
                    turn = 2.0 * std::f64::consts::PI - turn;
                }
                if turn > 45f64.to_radians() {
                    corners.push(d[i]);
                }
            }
            for &c in &corners {
                for i in 0..n {
                    if d[i] >= c - 40.0 && d[i] <= c + 80.0 {
                        keep[i] = false;
                    }
                }
            }
        }
    }
    keep
}

/// The fit's design plus what is needed to map results back to the legs.
pub struct BuiltDesign {
    pub design: Design,
    pub closed_loop: bool,
    pub loop_length: Option<f64>,
    /// For each leg, road-position spans (m) the pre-masks cut out.
    pub masked: Vec<Vec<(f64, f64)>>,
}

/// Every leg on one road axis — map-matched onto the first leg's GPS track
/// (B7), or its distance ridden when any leg lacks GPS — split into clean
/// stretches at every masked sample (B6), each kept monotone along the road
/// and thinned to `grid_m`. A closed loop is cut at its widest empty gap
/// (`loop_cut`). Legs are labelled by direction (0 with the road, 1
/// against it) for the per-direction terrain choice. `masks` overrides
/// `premask` (tests).
pub fn build_design(input: &SelectionInput, masks: Option<&[Vec<bool>]>) -> Result<BuiltDesign, FitError> {
    let legs = &input.legs;
    let has_gps = legs
        .iter()
        .all(|l| l.lat.len() == l.distance.len() && Route::new(&l.lat, &l.lon).is_some());
    let route = if has_gps { legs.first().and_then(|l| Route::new(&l.lat, &l.lon)) } else { None };
    let closed = route.as_ref().is_some_and(|r| r.closed);
    let loop_length = route.as_ref().filter(|r| r.closed).map(|r| r.length);

    let mut raw: Vec<Vec<f64>> = legs
        .iter()
        .map(|l| match &route {
            Some(r) => r.positions(&l.lat, &l.lon),
            None => l.distance.clone(),
        })
        .collect();
    let keeps: Vec<Vec<bool>> = match masks {
        Some(m) => m.to_vec(),
        None => legs.iter().map(|l| premask(l, &input.physics)).collect(),
    };
    let kept = |l: usize, i: usize| keeps[l].get(i).copied().unwrap_or(false) && raw[l][i].is_finite();
    if let Some(length) = loop_length {
        let all: Vec<f64> = (0..legs.len())
            .flat_map(|l| (0..raw[l].len()).filter(move |&i| kept(l, i)).map(move |i| (l, i)))
            .map(|(l, i)| raw[l][i])
            .collect();
        let cut = loop_cut(&all, length);
        for leg in raw.iter_mut() {
            leg.iter_mut().for_each(|s| *s = (*s - cut).rem_euclid(length));
        }
    }

    let mut out_legs = Vec::with_capacity(legs.len());
    let mut masked = Vec::with_capacity(legs.len());
    for (l, leg) in legs.iter().enumerate() {
        let pos = &raw[l];
        let n = leg.distance.len();
        // Runs of kept samples.
        let mut runs: Vec<Vec<usize>> = Vec::new();
        let mut spans: Vec<(f64, f64)> = Vec::new();
        let mut current: Vec<usize> = Vec::new();
        let mut gap: Option<(f64, f64)> = None;
        for i in 0..n {
            if keeps[l].get(i).copied().unwrap_or(false) && pos[i].is_finite() {
                if let Some(g) = gap.take() {
                    spans.push(g);
                }
                current.push(i);
            } else {
                if !current.is_empty() {
                    runs.push(std::mem::take(&mut current));
                }
                if pos[i].is_finite() {
                    gap = Some(gap.map_or((pos[i], pos[i]), |(a, _)| (a, pos[i])));
                }
            }
        }
        if !current.is_empty() {
            runs.push(current);
        }
        if let Some(g) = gap {
            spans.push(g);
        }
        // Monotone along the road and thinned, per run.
        let mut chosen: Vec<(usize, u32)> = Vec::new();
        for (id, run) in runs.iter().enumerate() {
            let rising = pos[*run.last().unwrap()] >= pos[run[0]];
            let mut picked: Vec<usize> = Vec::new();
            for &i in run {
                if let Some(&last) = picked.last() {
                    let ahead = if rising { pos[i] > pos[last] } else { pos[i] < pos[last] };
                    if !ahead || leg.distance[i] - leg.distance[last] < input.options.grid_m {
                        continue;
                    }
                }
                picked.push(i);
            }
            if picked.len() >= 3 {
                chosen.extend(picked.into_iter().map(|i| (i, id as u32)));
            }
        }
        let rising = match (chosen.first(), chosen.last()) {
            (Some(&(a, _)), Some(&(b, _))) => pos[b] >= pos[a],
            _ => true,
        };
        out_legs.push(LegDesign {
            group: if rising { 0 } else { 1 },
            pos: chosen.iter().map(|&(i, _)| pos[i]).collect(),
            drift: chosen.iter().map(|&(i, _)| leg.distance[i]).collect(),
            y: chosen.iter().map(|&(i, _)| leg.y[i]).collect(),
            columns: leg.columns.iter().map(|c| chosen.iter().map(|&(i, _)| c[i]).collect()).collect(),
            stretch: chosen.iter().map(|&(_, s)| s).collect(),
        });
        masked.push(spans);
    }
    Ok(BuiltDesign {
        design: Design {
            names: input.names.clone(),
            legs: out_legs,
        },
        closed_loop: closed,
        loop_length,
        masked,
    })
}

// ---- JSON ----

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FitSummary {
    pub names: Vec<String>,
    pub beta: Vec<f64>,
    pub se: Vec<f64>,
    /// Covariance of the shared parameters.
    pub cov: Vec<Vec<f64>>,
    /// q per 5 m (m²), s2 (m²), ell (m), r (m²).
    pub noise: NoiseSummary,
    pub jumps: Vec<JumpSummary>,
    pub warnings: Vec<String>,
    pub cda_crr_correlation: Option<f64>,
    pub speed_contrast: Option<f64>,
    pub legs: usize,
    pub observations: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoiseSummary {
    pub q_per_5m: f64,
    pub s2: f64,
    pub ell: f64,
    pub r: f64,
    pub terrain_by_direction: bool,
    pub at_bound: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpSummary {
    pub leg: usize,
    pub label: String,
    pub pos: f64,
    pub distance: f64,
    pub size: f64,
    pub t: f64,
    pub fitted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegResiduals {
    pub label: String,
    /// Road position (m) and residual y − Xβ (m), the leg's stretch offsets
    /// and jumps removed: every stretch centred on its own fitted offset (B11).
    pub pos: Vec<f64>,
    pub residual: Vec<f64>,
    pub stretch: Vec<u32>,
    pub masked: Vec<(f64, f64)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub session: usize,
    pub status: String,
    pub reason: Option<String>,
    pub fit: Option<FitSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionZSummary {
    pub name: String,
    pub first: usize,
    pub second: usize,
    pub z: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionOutput {
    /// "ok" or "refused".
    pub status: String,
    /// The named fallback when refused (spec §4).
    pub reason: Option<String>,
    pub coupled: Option<(String, String)>,
    pub fit: Option<FitSummary>,
    pub residuals: Vec<LegResiduals>,
    pub closed_loop: bool,
    pub loop_length: Option<f64>,
    /// Only with more than one session.
    pub sessions: Vec<SessionSummary>,
    pub session_z: Vec<SessionZSummary>,
}

fn reason(e: &FitError) -> (String, Option<(String, String)>) {
    match e {
        FitError::TooFewLegs => ("tooFewLegs".into(), None),
        FitError::TooFewObservations => ("tooFewObservations".into(), None),
        FitError::CdaNeedsAirspeed => ("cdaNeedsAirspeed".into(), None),
        FitError::NotIdentified { coupled } => ("notIdentified".into(), coupled.clone()),
    }
}

fn warning_text(w: &Warning) -> String {
    match w {
        Warning::NoCommonRoad => "noCommonRoad".into(),
        Warning::NoiseAtBound(which) => format!("noiseAtBound:{}", which.join(",")),
        Warning::TooManyDisturbances => "tooManyDisturbances".into(),
        Warning::WeakSpeedContrast(c) => format!("weakSpeedContrast:{:.3}", c),
        Warning::ModelledWind => "modelledWind".into(),
    }
}

fn summary(labels: &[String], r: &KalmanResult) -> FitSummary {
    let names: Vec<String> = r
        .fit
        .names
        .iter()
        .take_while(|n| !n.starts_with("offset ") && !n.starts_with("jump "))
        .cloned()
        .collect();
    let p = names.len();
    FitSummary {
        names: names.clone(),
        beta: r.fit.beta[..p].to_vec(),
        se: r.fit.se[..p].to_vec(),
        cov: r.fit.cov[..p].iter().map(|row| row[..p].to_vec()).collect(),
        noise: NoiseSummary {
            q_per_5m: r.noise.noise.q * 5.0,
            s2: r.noise.noise.s2,
            ell: r.noise.noise.ell,
            r: r.noise.noise.r,
            terrain_by_direction: r.noise.terrain_by_direction,
            at_bound: r.noise.at_bound.iter().map(|s| s.to_string()).collect(),
        },
        jumps: r
            .jumps
            .iter()
            .map(|j| JumpSummary {
                leg: j.leg,
                label: labels.get(j.leg).cloned().unwrap_or_default(),
                pos: j.pos,
                distance: j.drift,
                size: j.size,
                t: j.t,
                fitted: j.fitted,
            })
            .collect(),
        warnings: r.warnings.iter().map(warning_text).collect(),
        cda_crr_correlation: r.cda_crr_correlation,
        speed_contrast: r.speed_contrast,
        legs: r.legs,
        observations: r.fit.n_obs,
    }
}

fn kalman_options(o: &SelectionOptions) -> KalmanOptions {
    KalmanOptions {
        jumps: o.jumps,
        fixed_cda: o.fixed_cda,
        air_speed: match o.air_speed.as_str() {
            "modelled" => AirSpeed::Modelled,
            "groundSpeed" => AirSpeed::GroundSpeed,
            _ => AirSpeed::Measured,
        },
        ..KalmanOptions::default()
    }
}

/// The whole J6 fit on one selection.
pub fn fit_selection(input: &SelectionInput) -> SelectionOutput {
    let refused = |e: &FitError| {
        let (reason, coupled) = reason(e);
        SelectionOutput {
            status: "refused".into(),
            reason: Some(reason),
            coupled,
            fit: None,
            residuals: Vec::new(),
            closed_loop: false,
            loop_length: None,
            sessions: Vec::new(),
            session_z: Vec::new(),
        }
    };
    if input.legs.len() < 2 {
        return refused(&FitError::TooFewLegs);
    }
    let built = match build_design(input, None) {
        Ok(b) => b,
        Err(e) => return refused(&e),
    };
    let labels: Vec<String> = input.legs.iter().map(|l| l.label.clone()).collect();
    let options = kalman_options(&input.options);
    let result = match kalman_fit(&built.design, &options) {
        Ok(r) => r,
        Err(e) => {
            let mut out = refused(&e);
            out.closed_loop = built.closed_loop;
            out.loop_length = built.loop_length;
            return out;
        }
    };
    let grouped = &result.design;
    let steps: Vec<StepAt> = result
        .jumps
        .iter()
        .filter(|j| j.fitted)
        .map(|j| StepAt { leg: j.leg, obs: j.obs })
        .collect();
    let residual = fitted_residuals(grouped, &steps, &result.fit.beta);
    let residuals = grouped
        .legs
        .iter()
        .enumerate()
        .map(|(l, leg)| LegResiduals {
            label: labels[l].clone(),
            pos: leg.pos.clone(),
            residual: residual[l].clone(),
            stretch: leg.stretch.clone(),
            masked: built.masked[l].clone(),
        })
        .collect();

    let session_of: Vec<usize> = input.legs.iter().map(|l| l.session).collect();
    let mut distinct = session_of.clone();
    distinct.sort_unstable();
    distinct.dedup();
    let (sessions, session_z) = if distinct.len() > 1 {
        match session_comparison(&built.design, &session_of, &options) {
            Ok(cmp) => (
                cmp.per_session
                    .iter()
                    .map(|(s, r)| match r {
                        Ok(r) => SessionSummary {
                            session: *s,
                            status: "ok".into(),
                            reason: None,
                            fit: Some(summary(&labels, r)),
                        },
                        Err(e) => SessionSummary {
                            session: *s,
                            status: "refused".into(),
                            reason: Some(reason(e).0),
                            fit: None,
                        },
                    })
                    .collect(),
                cmp.z
                    .iter()
                    .map(|z| SessionZSummary {
                        name: z.name.clone(),
                        first: z.first,
                        second: z.second,
                        z: z.z,
                    })
                    .collect(),
            ),
            Err(_) => (Vec::new(), Vec::new()),
        }
    } else {
        (Vec::new(), Vec::new())
    };

    SelectionOutput {
        status: "ok".into(),
        reason: None,
        coupled: None,
        fit: Some(summary(&labels, &result)),
        residuals,
        closed_loop: built.closed_loop,
        loop_length: built.loop_length,
        sessions,
        session_z,
    }
}

/// `fit_selection` for JavaScript: `SelectionInput` as JSON in,
/// `SelectionOutput` as JSON out. Malformed input comes back as
/// `{"status":"refused","reason":"badInput",…}`.
#[wasm_bindgen]
pub fn fit_selection_json(input: &str) -> String {
    let output = match serde_json::from_str::<SelectionInput>(input) {
        Ok(input) => fit_selection(&input),
        Err(e) => SelectionOutput {
            status: "refused".into(),
            reason: Some(format!("badInput: {}", e)),
            coupled: None,
            fit: None,
            residuals: Vec::new(),
            closed_loop: false,
            loop_length: None,
            sessions: Vec::new(),
            session_z: Vec::new(),
        },
    };
    serde_json::to_string(&output).unwrap_or_else(|e| format!("{{\"status\":\"refused\",\"reason\":\"badOutput: {}\"}}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A straight east–west road at 51° N, sampled every `step` metres from
    /// `from` to `to` (metres east of the origin), as (lat, lon).
    fn straight(from: f64, to: f64, step: f64) -> (Vec<f64>, Vec<f64>) {
        let n = ((to - from).abs() / step).round() as usize + 1;
        let sign = (to - from).signum();
        let lon0 = 7.0;
        let k = 111_320.0 * 51f64.to_radians().cos();
        let lat = vec![51.0; n];
        let lon = (0..n).map(|i| lon0 + (from + sign * step * i as f64) / k).collect();
        (lat, lon)
    }

    #[test]
    fn route_positions_follow_the_road_both_ways() {
        let (rlat, rlon) = straight(0.0, 1000.0, 10.0);
        let route = Route::new(&rlat, &rlon).unwrap();
        assert!((route.length - 1000.0).abs() < 1.0);
        assert!(!route.closed);
        let (lat, lon) = straight(995.0, 5.0, 7.0);
        let s = route.positions(&lat, &lon);
        assert!((s[0] - 995.0).abs() < 0.5, "{}", s[0]);
        let last = 995.0 - 7.0 * (s.len() - 1) as f64;
        assert!((s[s.len() - 1] - last).abs() < 0.5, "{} vs {}", s[s.len() - 1], last);
        assert!(s.windows(2).all(|w| w[1] < w[0]));
    }

    /// A square loop: closed, and a second lap starting part-way round maps
    /// onto the same positions.
    #[test]
    fn closed_loop_is_detected() {
        let k = 111_320.0 * 51f64.to_radians().cos();
        let corner = |x: f64, y: f64| (51.0 + y / 111_320.0, 7.0 + x / k);
        let mut lat = vec![];
        let mut lon = vec![];
        let side = 250.0;
        for i in 0..=100 {
            let t = i as f64 * 10.0;
            let (x, y) = match t {
                t if t <= side => (t, 0.0),
                t if t <= 2.0 * side => (side, t - side),
                t if t <= 3.0 * side => (3.0 * side - t, side),
                t => (0.0, 4.0 * side - t),
            };
            let (a, b) = corner(x, y);
            lat.push(a);
            lon.push(b);
        }
        let route = Route::new(&lat, &lon).unwrap();
        assert!(route.closed);
        assert!((route.length - 1000.0).abs() < 1.0);
        let (a, b) = corner(side, 100.0);
        let s = route.positions(&[a], &[b]);
        assert!((s[0] - 350.0).abs() < 0.5, "{}", s[0]);
    }

    /// A sample-level leg: 1 Hz, steady 8 m/s on a flat straight road, with
    /// power that holds it there.
    fn steady_leg(n: usize) -> LegInput {
        let (lat, lon) = straight(0.0, 8.0 * (n - 1) as f64, 8.0);
        let speed = vec![8.0; n];
        let mass = 85.0;
        // P = (½ρCdA v² + Crr m g) v at CdA 0.3, Crr 0.004, ρ 1.2.
        let p = (0.5 * 1.2 * 0.3 * 64.0 + 0.004 * mass * 9.807) * 8.0;
        LegInput {
            label: "leg".into(),
            session: 0,
            timestamps: (0..n).map(|i| i as f64).collect(),
            power: vec![p; n],
            speed: speed.clone(),
            air_speed: speed,
            rho: 1.2,
            distance: (0..n).map(|i| 8.0 * i as f64).collect(),
            lat,
            lon,
            elevation: vec![0.0; n],
            y: vec![0.0; n],
            columns: vec![vec![0.0; n], vec![0.0; n]],
        }
    }

    fn physics() -> Physics {
        Physics {
            mass: 85.0,
            eta: 1.0,
            cda: 0.3,
            crr: 0.004,
        }
    }

    #[test]
    fn steady_riding_is_kept_except_the_lap_button_ends() {
        let leg = steady_leg(120);
        let keep = premask(&leg, &physics());
        let d = &leg.distance;
        for i in 0..d.len() {
            let end = d[i] < 20.0 || d[i] > d[d.len() - 1] - 20.0;
            assert_eq!(keep[i], !end, "sample {} at {} m", i, d[i]);
        }
    }

    /// Speed dropping 3 m/s in 2 s at full power is braking: masked from
    /// 3 s before to 2 s after.
    #[test]
    fn braking_is_masked() {
        let mut leg = steady_leg(120);
        for i in 60..120 {
            leg.speed[i] = if i < 62 { 8.0 - 1.5 * (i - 59) as f64 } else { 5.0 };
            leg.air_speed[i] = leg.speed[i];
        }
        let mut d = 0.0;
        for i in 1..120 {
            d += 0.5 * (leg.speed[i] + leg.speed[i - 1]);
            leg.distance[i] = d;
        }
        let keep = premask(&leg, &physics());
        assert!(keep[50]);
        for i in 57..=64 {
            assert!(!keep[i], "sample {} not masked", i);
        }
        assert!(keep[75]);
    }

    /// A right-angle bend: masked 40 m before and 80 m after.
    #[test]
    fn corners_are_masked_asymmetrically() {
        let n = 100;
        let mut leg = steady_leg(n);
        let k = 111_320.0 * 51f64.to_radians().cos();
        for i in 0..n {
            let s = 8.0 * i as f64;
            let (x, y) = if s <= 400.0 { (s, 0.0) } else { (400.0, s - 400.0) };
            leg.lat[i] = 51.0 + y / 111_320.0;
            leg.lon[i] = 7.0 + x / k;
        }
        let keep = premask(&leg, &physics());
        for i in 0..n {
            let s = leg.distance[i];
            if s < 20.0 || s > leg.distance[n - 1] - 20.0 {
                continue;
            }
            let near = s > 400.0 - 40.0 - 8.0 && s < 400.0 + 80.0 + 8.0;
            let far = s < 400.0 - 40.0 - 25.0 || s > 400.0 + 80.0 + 25.0;
            if far {
                assert!(keep[i], "{} m masked", s);
            }
            if near && (s - 400.0).abs() < 30.0 {
                assert!(!keep[i], "{} m kept", s);
            }
            if s > 400.0 + 10.0 && s < 400.0 + 70.0 {
                assert!(!keep[i], "{} m kept after the corner", s);
            }
            if s < 400.0 - 30.0 && s > 400.0 - 40.0 + 8.0 {
                assert!(!keep[i], "{} m kept before the corner", s);
            }
        }
    }

    /// Two legs on the same road in opposite directions: one road axis, a
    /// masked gap splits a leg into two stretches, observations at least the
    /// grid step apart.
    #[test]
    fn selection_design_aligns_legs_and_splits_stretches() {
        let out = steady_leg(130);
        let mut back = steady_leg(130);
        let (lat, lon) = straight(8.0 * 129.0, 0.0, 8.0);
        back.lat = lat;
        back.lon = lon;
        let mut keep_back = premask(&back, &physics());
        for k in keep_back.iter_mut().take(70).skip(60) {
            *k = false;
        }
        let input = SelectionInput {
            names: vec!["CdA".into(), "Crr".into()],
            legs: vec![out.clone(), back.clone()],
            physics: physics(),
            options: SelectionOptions::default(),
        };
        let built = build_design(&input, Some(&[premask(&out, &physics()), keep_back])).unwrap();
        assert!(!built.closed_loop);
        let (a, b) = (&built.design.legs[0], &built.design.legs[1]);
        assert_eq!(a.group, 0);
        assert_eq!(b.group, 1, "the return leg is labelled by direction");
        assert!((a.pos[0] - 24.0).abs() < 1.0 && (b.pos[0] - (8.0 * 129.0 - 24.0)).abs() < 1.0);
        let stretches: Vec<u32> = {
            let mut s = b.stretch.clone();
            s.dedup();
            s
        };
        assert_eq!(stretches.len(), 2);
        for leg in &built.design.legs {
            assert!(leg.drift.windows(2).all(|w| w[1] - w[0] >= input.options.grid_m - 1e-9));
        }
    }

    #[test]
    fn json_entry_refuses_one_leg_by_name() {
        let input = SelectionInput {
            names: vec!["CdA".into(), "Crr".into()],
            legs: vec![steady_leg(100)],
            physics: physics(),
            options: SelectionOptions::default(),
        };
        let out: serde_json::Value = serde_json::from_str(&fit_selection_json(&serde_json::to_string(&input).unwrap())).unwrap();
        assert_eq!(out["status"], "refused");
        assert_eq!(out["reason"], "tooFewLegs");
    }
}
