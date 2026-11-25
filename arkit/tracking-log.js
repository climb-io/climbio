// 2D 牆相機追蹤紀錄：對齊 docs/3d-tracking.md 的指標與隱私規格（不含影像、影格像素或裝置識別碼）。
const round = (v, n = 1) => (Number.isFinite(v) ? Number(v.toFixed(n)) : null);
const percentile = (values, p) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return round(s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))], 2);
};
const stats = (values) => ({
  n: values.length,
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  max: values.length ? round(Math.max(...values), 2) : null,
});

export class TrackingLog2d {
  constructor({
    build,
    manifest,
    device,
    storage = null,
    now = () => performance.now(),
    date = () => new Date().toISOString(),
  }) {
    this.now = now;
    this.date = date;
    this.storage = storage;
    this.start = now();
    this.active = null;
    this.segment = null;
    this.previousH = null;
    this.lastFrame = null;
    this.visible = false;
    this.bucket = null;
    this.lastPersist = 0;
    this.previousReport = null;
    this.lastDiagnosticAt = -Infinity;
    try {
      this.previousReport = JSON.parse(storage?.getItem('climbio.tracking2d.last') || 'null');
    } catch {
      this.previousReport = null;
    }
    this.data = {
      schema: 'climbio-2d-tracking-log/1',
      build,
      startedAt: date(),
      device,
      wallManifest: manifest,
      sessions: [],
      events: [],
      samples: [],
      diagnosticSamples: [],
      diagnosticColumns: [
        't_s', 'session_started_s', 'stage', 'reason', 'wall_id',
        'query_features', 'matched_pairs', 'flow_points', 'inliers',
        'coverage', 'best_wall', 'best_wall_coarse_hits', 'median_error_px',
      ],
      sampleColumns: [
        't_s', 'wall_id', 'located', 'inliers', 'feature_error_px',
        'latency_ms', 'processing_ms', 'tracking_hz', 'render_fps',
        'video_fps', 'corner_delta_px', 'mode',
      ],
      notes: {
        latency: 'capture-to-worker-result; excludes camera sensor/display',
        featureError: 'feature reprojection; not physical hold accuracy',
        containsImages: false,
        containsFramePixels: false,
      },
    };
  }

  time() {
    return round((this.now() - this.start) / 1000, 2);
  }

  event(kind, details = {}) {
    this.data.events.push({ t: this.time(), kind, ...details });
    if (this.data.events.length > 120) this.data.events.shift();
  }

  begin(targetWall = 'auto', source = 'camera') {
    this.end();
    this.previousH = null;
    this.visible = false;
    this.active = {
      startedAt: this.time(),
      source,
      streamAt: null,
      firstPreviewAt: null,
      readyAt: null,
      firstPoseAt: null,
      endedAt: null,
      timings: {},
      segments: [],
      settings: null,
    };
    this.data.sessions.push(this.active);
    if (this.data.sessions.length > 10) this.data.sessions.shift();
    this.event('camera_requested', { source });
    this.variant(targetWall);
  }

  variant(targetWall = 'auto') {
    if (!this.active) return;
    this.flush();
    if (this.segment) this.segment.endedAt = this.time();
    this.lastFrame = null;
    this.segment = {
      targetWall,
      matchedWalls: {},
      startedAt: this.time(),
      endedAt: null,
      frames: 0,
      validFrames: 0,
      visibleMs: 0,
      measuredMs: 0,
      losses: 0,
      staleHides: 0,
      reacquisitionsMs: [],
      latency: [],
      processing: [],
      inliers: [],
      errors: [],
      render: [],
      video: [],
      cornerDeltas: [],
      lossStart: null,
    };
    this.active.segments.push(this.segment);
    this.bucket = { at: this.now(), render: 0, video: 0, frames: 0 };
    this.previousH = null;
    this.event('wall_target_selected', { targetWall });
  }

  stream(settings) {
    if (!this.active) return;
    this.active.streamAt = this.time();
    const allowed = ['width', 'height', 'frameRate', 'aspectRatio', 'facingMode', 'zoom', 'focusMode', 'exposureMode', 'whiteBalanceMode'];
    this.bucket = { at: this.now(), render: 0, video: 0, frames: 0 };
    this.active.settings = Object.fromEntries(
      allowed.filter((k) => settings && settings[k] !== undefined).map((k) => [k, settings[k]])
    );
    this.event('camera_opened');
  }

  ready() {
    if (this.active) this.active.readyAt = this.time();
    this.event('runtime_ready');
  }

  firstPreview() {
    if (this.active && this.active.firstPreviewAt === null) {
      this.active.firstPreviewAt = this.time();
      this.event('first_preview');
    }
  }

  setTimings(patch) {
    if (this.active && patch) Object.assign(this.active.timings, patch);
  }

  frame({ pose, mode, latency, processingMs, cornerDeltaPx = null, diagnostics = null }) {
    const s = this.segment;
    if (!s) return;
    if (diagnostics && (diagnostics.stage === 'search' || this.time() - this.lastDiagnosticAt >= 1)) {
      const d = diagnostics;
      const best = d.coarseHits?.[0];
      this.data.diagnosticSamples.push([
        this.time(), this.active.startedAt, d.stage, d.reason, pose?.wallId ?? null,
        d.queryFeatures ?? null, d.matchedPairs ?? null, d.flowPoints ?? null,
        pose?.inliers ?? d.maxInliers ?? 0, round(pose?.coverage ?? d.coverage, 3),
        best?.[0] ?? null, best?.[1] ?? 0, round(pose?.medianError ?? d.medianError, 2),
      ]);
      if (this.data.diagnosticSamples.length > 240) this.data.diagnosticSamples.shift();
      this.lastDiagnosticAt = this.time();
    }
    s.frames++;
    if (this.bucket) this.bucket.frames++;
    this.lastFrame = { pose, mode, latency, processingMs, cornerDeltaPx, diagnostics };
    for (const [target, value] of [[s.latency, latency], [s.processing, processingMs]]) {
      if (Number.isFinite(value) && target.length < 6000) target.push(value);
    }
    if (pose) {
      s.validFrames++;
      if (pose.wallId) s.matchedWalls[pose.wallId] = (s.matchedWalls[pose.wallId] || 0) + 1;
      if (s.inliers.length < 6000) {
        s.inliers.push(pose.inliers);
        if (Number.isFinite(pose.medianError)) s.errors.push(pose.medianError);
      }
      if (Number.isFinite(cornerDeltaPx) && s.cornerDeltas.length < 6000) {
        s.cornerDeltas.push(cornerDeltaPx);
      }
      if (this.active.firstPoseAt === null) {
        this.active.firstPoseAt = this.time();
        this.event('first_pose', { wallId: pose.wallId });
      }
      if (s.lossStart !== null) {
        s.reacquisitionsMs.push((this.time() - s.lossStart) * 1000);
        s.lossStart = null;
        this.event('relocalized', { wallId: pose.wallId });
      }
      this.previousH = pose.H;
    } else {
      if (this.previousH) {
        s.losses++;
        s.lossStart = this.time();
        this.event('tracking_lost');
      }
      this.previousH = null;
    }
  }

  tick({ dt = 0, rendered = false, visible = false, videoFrames = 0 }) {
    if (!this.segment) return;
    const s = this.segment;
    s.measuredMs += dt;
    if (visible) s.visibleMs += dt;
    if (this.visible && !visible && this.lastFrame?.pose) {
      s.staleHides++;
      this.event('pose_stale');
    }
    this.visible = visible;
    if (this.bucket) {
      if (rendered) this.bucket.render++;
      this.bucket.video += videoFrames;
      if (this.now() - this.bucket.at >= 1000) this.flush();
    }
    if (this.now() - this.lastPersist > 5000) this.persist();
  }

  flush() {
    if (!this.bucket || !this.segment) return;
    const seconds = (this.now() - this.bucket.at) / 1000;
    if (seconds < 0.2) return;
    const s = this.segment, b = this.bucket, f = this.lastFrame, p = f?.pose;
    const render = b.render / seconds, video = b.video / seconds;
    if (s.render.length < 6000) {
      s.render.push(render);
      s.video.push(video);
    }
    this.data.samples.push([
      this.time(), p?.wallId ?? null, this.visible ? 1 : 0, p?.inliers ?? 0,
      round(p?.medianError, 2), round(f?.latency), round(f?.processingMs),
      round(b.frames / seconds), round(render), round(video),
      round(f?.cornerDeltaPx, 2), f?.mode ?? 'idle',
    ]);
    if (this.data.samples.length > 240) this.data.samples.shift();
    this.bucket = { at: this.now(), render: 0, video: 0, frames: 0 };
  }

  mark(kind, details = {}) {
    this.event('user_mark', {
      ...details,
      diagnostics: this.lastFrame?.diagnostics ?? null,
      mark: kind,
      wallId: this.lastFrame?.pose?.wallId ?? null,
      tracking: this.visible,
      lastInliers: this.lastFrame?.pose?.inliers ?? 0,
    });
    this.persist();
  }

  error(error) {
    this.event('error', { name: String(error?.name || 'Error'), message: String(error?.message || error).slice(0, 300) });
    this.persist();
  }

  end() {
    if (!this.active) return;
    this.flush();
    this.active.endedAt = this.time();
    if (this.segment) this.segment.endedAt = this.time();
    this.event('camera_stopped');
    this.active = null;
    this.segment = null;
    this.previousH = null;
    this.bucket = null;
    this.visible = false;
    this.persist();
  }

  report() {
    if (!this.data.sessions.length && this.previousReport) return this.previousReport;
    return {
      ...this.data,
      exportedAt: this.date(),
      sessions: this.data.sessions.map((session) => ({
        ...session,
        firstPreviewAfterStartMs: session.firstPreviewAt === null ? null : round((session.firstPreviewAt - session.startedAt) * 1000),
        runtimeReadyAfterStreamMs: session.readyAt === null || session.streamAt === null ? null : round((session.readyAt - session.streamAt) * 1000),
        firstPoseAfterStreamMs: session.firstPoseAt === null || session.streamAt === null ? null : round((session.firstPoseAt - session.streamAt) * 1000),
        segments: session.segments.map((s) => ({
          targetWall: s.targetWall,
          matchedWalls: { ...s.matchedWalls },
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          frames: s.frames,
          validFrames: s.validFrames,
          validFrameRatio: s.frames ? round(s.validFrames / s.frames, 3) : null,
          visibleRatio: s.measuredMs ? round(s.visibleMs / s.measuredMs, 3) : null,
          losses: s.losses,
          staleHides: s.staleHides,
          reacquisitionMs: stats(s.reacquisitionsMs),
          latencyMs: stats(s.latency),
          processingMs: stats(s.processing),
          inliers: stats(s.inliers),
          featureErrorPx: stats(s.errors),
          cornerDeltaPx: stats(s.cornerDeltas),
          renderFps: stats(s.render),
          videoFps: stats(s.video),
          openLossMs: s.lossStart === null ? null : round(((s.endedAt ?? this.time()) - s.lossStart) * 1000),
        })),
      })),
    };
  }

  text() {
    this.flush();
    return JSON.stringify(this.report());
  }

  persist() {
    this.lastPersist = this.now();
    try {
      this.storage?.setItem('climbio.tracking2d.last', JSON.stringify(this.report()));
    } catch {
      /* 忽略私密瀏覽配額限制 */
    }
  }
}
