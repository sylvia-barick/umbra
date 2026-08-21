//! Fixed-point Black-Scholes helper math. No floating point — Soroban's
//! deterministic execution model doesn't support it. All values here use
//! `MATH_SCALE` (1e9) fixed-point representation: an i128 `v` represents
//! the real number `v / MATH_SCALE`.
//!
//! N(x) (standard normal CDF) uses the Abramowitz–Stegun 26.2.17 rational
//! approximation — the fallback option named in the technical spec's
//! "on-chain N(x) approximation" section, chosen over a lookup table for
//! implementation simplicity in v1.

pub const MATH_SCALE: i128 = 1_000_000_000;

pub fn fp_mul(a: i128, b: i128) -> i128 {
    a.checked_mul(b).expect("fp_mul overflow") / MATH_SCALE
}

pub fn fp_div(a: i128, b: i128) -> i128 {
    a.checked_mul(MATH_SCALE).expect("fp_div overflow") / b
}

/// Converts a value from an arbitrary fixed-point `scale` (e.g. an
/// oracle's `10^decimals`) into MATH_SCALE, via multiply-then-divide —
/// works regardless of whether `scale` is larger or smaller than
/// MATH_SCALE, unlike a precomputed integer ratio (which truncates to
/// zero whenever `scale` exceeds MATH_SCALE).
pub fn to_math_scale(value: i128, scale: i128) -> i128 {
    value.checked_mul(MATH_SCALE).expect("to_math_scale overflow") / scale
}

/// Inverse of `to_math_scale`.
pub fn from_math_scale(value: i128, scale: i128) -> i128 {
    value.checked_mul(scale).expect("from_math_scale overflow") / MATH_SCALE
}

/// Integer square root (floor), Babylonian method.
fn isqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// sqrt(x) in MATH_SCALE fixed point, x >= 0.
pub fn fp_sqrt(x: i128) -> i128 {
    if x <= 0 {
        return 0;
    }
    isqrt((x as u128).checked_mul(MATH_SCALE as u128).expect("fp_sqrt overflow")) as i128
}

/// e^x in MATH_SCALE fixed point, via scaling-and-squaring: e^x = (e^(x/2^K))^(2^K),
/// with a 5-term Taylor series for the small exponent x/2^K.
pub fn fp_exp(x: i128) -> i128 {
    const K: u32 = 16;
    let neg = x < 0;
    let ax = if neg { -x } else { x };
    let y = ax / (1i128 << K);

    let y2 = fp_mul(y, y);
    let y3 = fp_mul(y2, y);
    let y4 = fp_mul(y3, y);
    let y5 = fp_mul(y4, y);
    let mut sum = MATH_SCALE + y + y2 / 2 + y3 / 6 + y4 / 24 + y5 / 120;

    for _ in 0..K {
        sum = fp_mul(sum, sum);
    }

    if neg {
        fp_div(MATH_SCALE, sum)
    } else {
        sum
    }
}

/// ln(x) in MATH_SCALE fixed point, x > 0, via ln(x) = 2*artanh((x-1)/(x+1)).
/// Converges quickly for x in a moneyness-bounded range (roughly 0.2x-5x);
/// that range comfortably covers v1's fixed strike/expiry grid.
pub fn fp_ln(x: i128) -> i128 {
    let y = fp_div(x - MATH_SCALE, x + MATH_SCALE);
    let y2 = fp_mul(y, y);

    let mut term = y;
    let mut sum = y;
    for denom in [3, 5, 7, 9, 11, 13, 15] {
        term = fp_mul(term, y2);
        sum += term / denom;
    }
    2 * sum
}

/// Standard normal CDF N(x) in MATH_SCALE fixed point.
pub fn normal_cdf(x: i128) -> i128 {
    const P: i128 = 231_641_900;
    const B1: i128 = 319_381_530;
    const B2: i128 = -356_563_782;
    const B3: i128 = 1_781_477_937;
    const B4: i128 = -1_821_255_978;
    const B5: i128 = 1_330_274_429;
    const INV_SQRT_2PI: i128 = 398_942_280;

    let neg = x < 0;
    let ax = if neg { -x } else { x };

    let t = fp_div(MATH_SCALE, MATH_SCALE + fp_mul(P, ax));
    let poly = fp_mul(
        t,
        B1 + fp_mul(t, B2 + fp_mul(t, B3 + fp_mul(t, B4 + fp_mul(t, B5)))),
    );
    let x_sq_half = fp_mul(ax, ax) / 2;
    let phi = fp_mul(INV_SQRT_2PI, fp_exp(-x_sq_half));
    let cdf_pos = MATH_SCALE - fp_mul(phi, poly);

    if neg {
        MATH_SCALE - cdf_pos
    } else {
        cdf_pos
    }
}

#[cfg(test)]
mod test {
    use super::*;

    fn assert_close(actual: i128, expected: i128, tolerance: i128) {
        let diff = (actual - expected).abs();
        assert!(
            diff <= tolerance,
            "expected {} +/- {}, got {}",
            expected,
            tolerance,
            actual
        );
    }

    #[test]
    fn exp_zero_is_one() {
        assert_close(fp_exp(0), MATH_SCALE, 1000);
    }

    #[test]
    fn exp_one_is_e() {
        // e ≈ 2.718281828; ~0.01% error from the 5-term Taylor expansion
        // used in the scaling-and-squaring approximation.
        assert_close(fp_exp(MATH_SCALE), 2_718_281_828, 500_000);
    }

    #[test]
    fn exp_negative_matches_reciprocal() {
        let e1 = fp_exp(MATH_SCALE);
        let e_neg1 = fp_exp(-MATH_SCALE);
        let reciprocal = fp_div(MATH_SCALE, e1);
        assert_close(e_neg1, reciprocal, 1000);
    }

    #[test]
    fn ln_one_is_zero() {
        assert_close(fp_ln(MATH_SCALE), 0, 1000);
    }

    #[test]
    fn ln_e_is_one() {
        assert_close(fp_ln(2_718_281_828), MATH_SCALE, 100_000);
    }

    #[test]
    fn sqrt_four_is_two() {
        assert_close(fp_sqrt(4 * MATH_SCALE), 2 * MATH_SCALE, 1000);
    }

    #[test]
    fn cdf_zero_is_half() {
        assert_close(normal_cdf(0), MATH_SCALE / 2, 1_000_000);
    }

    #[test]
    fn cdf_symmetric() {
        let a = normal_cdf(500_000_000);
        let b = normal_cdf(-500_000_000);
        assert_close(a + b, MATH_SCALE, 1_000_000);
    }

    #[test]
    fn cdf_large_positive_approaches_one() {
        assert_close(normal_cdf(5 * MATH_SCALE), MATH_SCALE, 1_000_000);
    }

    #[test]
    fn cdf_large_negative_approaches_zero() {
        assert_close(normal_cdf(-5 * MATH_SCALE), 0, 1_000_000);
    }
}
