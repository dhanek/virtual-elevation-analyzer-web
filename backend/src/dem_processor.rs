use std::io::Cursor;

use proj4rs::Proj;
use tiff::decoder::{Decoder, DecodingResult, Limits};
use tiff::tags::Tag;
use wasm_bindgen::prelude::*;

mod geotransform;
mod projection;
mod sampler;
mod tiff_loader;

#[wasm_bindgen]
pub struct DEMProcessor {
    width: u32,
    height: u32,
    transform: GeoTransform,
    nodata_value: f64,
    data: Vec<f32>,
    wgs84_proj: Option<Proj>,
    dem_proj: Option<Proj>,
    logged_first_lookup: bool,
}

/// GeoTransform contains the affine transformation parameters
/// to convert from pixel coordinates to geographic coordinates.
#[derive(Debug, Clone)]
struct GeoTransform {
    /// X-coordinate of the upper-left corner of the upper-left pixel
    origin_x: f64,
    /// Y-coordinate of the upper-left corner of the upper-left pixel
    origin_y: f64,
    /// Pixel width in geographic units
    pixel_width: f64,
    /// Pixel height in geographic units (typically negative)
    pixel_height: f64,
    /// Rotation parameter (usually 0)
    rotation_x: f64,
    /// Rotation parameter (usually 0)
    rotation_y: f64,
    /// EPSG code from GeoKeyDirectoryTag (ProjectedCSTypeGeoKey or GeographicTypeGeoKey)
    epsg_code: Option<u16>,
}

impl GeoTransform {
    /// Convert pixel coordinates to geographic coordinates
    fn pixel_to_geo(&self, col: f64, row: f64) -> (f64, f64) {
        let x = self.origin_x + col * self.pixel_width + row * self.rotation_x;
        let y = self.origin_y + col * self.rotation_y + row * self.pixel_height;
        (x, y)
    }

    /// Convert geographic coordinates to pixel coordinates
    fn geo_to_pixel(&self, x: f64, y: f64) -> (f64, f64) {
        let det = self.pixel_width * self.pixel_height - self.rotation_x * self.rotation_y;
        if det.abs() < 1e-10 {
            return (0.0, 0.0);
        }

        let col =
            (self.pixel_height * (x - self.origin_x) - self.rotation_x * (y - self.origin_y)) / det;
        let row =
            (self.pixel_width * (y - self.origin_y) - self.rotation_y * (x - self.origin_x)) / det;
        (col, row)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_geotransform() {
        let transform = GeoTransform {
            origin_x: 0.0,
            origin_y: 100.0,
            pixel_width: 1.0,
            pixel_height: -1.0,
            rotation_x: 0.0,
            rotation_y: 0.0,
            epsg_code: None,
        };

        let (x, y) = transform.pixel_to_geo(10.0, 20.0);
        assert_eq!(x, 10.0);
        assert_eq!(y, 80.0);

        let (col, row) = transform.geo_to_pixel(10.0, 80.0);
        assert!((col - 10.0).abs() < 1e-6);
        assert!((row - 20.0).abs() < 1e-6);
    }
}
