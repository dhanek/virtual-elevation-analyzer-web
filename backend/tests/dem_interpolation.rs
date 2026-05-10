#[test]
fn dem_interpolation_bilinear_interpolation_uses_four_neighbor_weighted_average() {
    // bilinear interpolation uses four-neighbor weighted average
    let tx = 0.25_f64;
    let ty = 0.75_f64;

    let v00 = 100.0_f64;
    let v10 = 140.0_f64;
    let v01 = 180.0_f64;
    let v11 = 220.0_f64;

    let interpolated = v00 * (1.0 - tx) * (1.0 - ty)
        + v10 * tx * (1.0 - ty)
        + v01 * (1.0 - tx) * ty
        + v11 * tx * ty;

    let expected = 170.0_f64;
    assert!((interpolated - expected).abs() < 1e-9);
}
