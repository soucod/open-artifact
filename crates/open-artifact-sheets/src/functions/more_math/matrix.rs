//! Matrices (MDETERM, MINVERSE, MMULT) and sums over pairs of cells (SUMX2MY2, SUMX2PY2, SUMXMY2).
//!
//! The evaluator has already answered the first error in the ranges. Sums are [`coerce::add`]ed, so what is
//! left of rounding is 0: `MMULT({1E15,0.3,-1E15},{1;1;1})` is 0.

use crate::coerce::add;
use crate::functions::{array, number, Answer, Arg, Cells};
use crate::value::{Array, CellError, Value};

pub fn call(name: &str, args: &[Arg]) -> Option<Answer> {
    Some(match name {
        "MDETERM" => square(&args[0]).and_then(|m| number(determinant(m))),
        "MINVERSE" => square(&args[0]).and_then(inverse),
        "MMULT" => multiply(&args[0], &args[1]),
        "SUMX2MY2" => sum_of_pairs(args, |x, y| add(x * x, -(y * y))),
        "SUMX2PY2" => sum_of_pairs(args, |x, y| add(x * x, y * y)),
        "SUMXMY2" => sum_of_pairs(args, |x, y| {
            let d = add(x, -y);
            d * d
        }),
        _ => return None,
    })
}

/// The numbers of a matrix, row by row: anything but a number (text, a boolean, a blank) is #VALUE!.
fn matrix(arg: &Arg) -> Result<(usize, usize, Vec<f64>), CellError> {
    let cells = arg.cells();
    let n = cells
        .values()
        .map(|v| match v {
            Value::Number(n) => Ok(*n),
            _ => Err(CellError::Value),
        })
        .collect::<Result<Vec<f64>, CellError>>()?;
    Ok((cells.rows(), cells.columns(), n))
}

/// A square matrix as rows; one of another shape is #VALUE!.
fn square(arg: &Arg) -> Result<Vec<Vec<f64>>, CellError> {
    let (rows, columns, n) = matrix(arg)?;
    if rows != columns {
        return Err(CellError::Value);
    }
    Ok(n.chunks(columns).map(<[f64]>::to_vec).collect())
}

/// Gaussian elimination: the row with the largest pivot (the first of equals) is swapped up,
/// divided by its pivot, and taken from the rows below.
fn determinant(mut a: Vec<Vec<f64>>) -> f64 {
    let n = a.len();
    let mut det = 1.0;
    for c in 0..n {
        let p = pivot_row(&a, c);
        if a[p][c] == 0.0 {
            return 0.0;
        }
        if p != c {
            a.swap(p, c);
            det = -det;
        }
        let pivot = a[c][c];
        det *= pivot;
        for k in c..n {
            a[c][k] /= pivot;
        }
        for r in c + 1..n {
            let f = a[r][c];
            for k in c..n {
                a[r][k] = add(a[r][k], -(f * a[c][k]));
            }
        }
    }
    det
}

fn pivot_row(a: &[Vec<f64>], c: usize) -> usize {
    let mut p = c;
    for r in c + 1..a.len() {
        if a[r][c].abs() > a[p][c].abs() {
            p = r;
        }
    }
    p
}

/// Gauss–Jordan elimination beside the identity, pivoting as [`determinant`] does; a pivot of 0 is #NUM!. A value
/// past the largest number is #NUM! in its place.
fn inverse(m: Vec<Vec<f64>>) -> Answer {
    let n = m.len();
    let mut a: Vec<Vec<f64>> = m
        .into_iter()
        .enumerate()
        .map(|(i, mut row)| {
            row.extend((0..n).map(|j| if i == j { 1.0 } else { 0.0 }));
            row
        })
        .collect();
    for c in 0..n {
        let p = pivot_row(&a, c);
        if a[p][c] == 0.0 {
            return Err(CellError::Number);
        }
        a.swap(p, c);
        let pivot = a[c][c];
        for k in 0..2 * n {
            a[c][k] /= pivot;
        }
        for r in 0..n {
            if r == c {
                continue;
            }
            let f = a[r][c];
            for k in 0..2 * n {
                a[r][k] = add(a[r][k], -(f * a[c][k]));
            }
        }
    }
    let mut values = Vec::with_capacity(n * n);
    for row in a {
        for v in &row[n..] {
            values.push(Value::number(*v));
        }
    }
    array(Array::new(n, n, values))
}

/// MMULT: the first matrix's columns must be as many as the second's rows; a sum past the largest number is #NUM!
/// in its place.
fn multiply(a: &Arg, b: &Arg) -> Answer {
    let (rows, inner, a) = matrix(a)?;
    let (inner_b, columns, b) = matrix(b)?;
    if inner != inner_b {
        return Err(CellError::Value);
    }
    let mut values = Vec::with_capacity(rows * columns);
    for i in 0..rows {
        for j in 0..columns {
            let sum = (0..inner).fold(0.0, |sum, k| add(sum, a[i * inner + k] * b[k * columns + j]));
            values.push(Value::number(sum));
        }
    }
    array(Array::new(rows, columns, values))
}

/// SUMX2MY2 and its kin: the two must be the same size; pairs where both are numbers count (a value written as
/// one is a range of one, so `SUMX2MY2("3",2)` is 0).
fn sum_of_pairs(args: &[Arg], term: fn(f64, f64) -> f64) -> Answer {
    let x: Cells = args[0].cells();
    let y: Cells = args[1].cells();
    if x.rows() != y.rows() || x.columns() != y.columns() {
        return Err(CellError::Value);
    }
    let mut sum = 0.0;
    for (a, b) in x.values().zip(y.values()) {
        if let (Value::Number(a), Value::Number(b)) = (a, b) {
            sum = add(sum, term(*a, *b));
        }
    }
    number(sum)
}
