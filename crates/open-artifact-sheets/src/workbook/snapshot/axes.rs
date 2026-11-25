//! Snapshot axes retain their deleted ids, and encode row order as a permutation of sorted ids.

use hashbrown::{HashMap, HashSet};
use serde::{Deserialize, Serialize};

use crate::ids::{runs_of, Axis, Bases, IdRun, LineId};

const DIGITS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) enum Rows {
    RunByRun(Vec<Run>),
    InOrder(Order),
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Run {
    ids: IdRun,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    is_deleted: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Order {
    all: OrderedIds,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    deleted: Vec<Ids>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct OrderedIds {
    ids: Vec<Ids>,
    order: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Ids {
    pub base: String,
    pub runs: Vec<[u32; 2]>,
}

pub(super) fn grouped_ids(ids: &[(impl AsRef<str>, u32)]) -> Vec<Ids> {
    let mut groups: Vec<Ids> = Vec::new();
    for (base, number) in ids {
        let (base, number) = (base.as_ref(), *number);
        if groups.last().is_none_or(|group| group.base != base) {
            groups.push(Ids {
                base: base.into(),
                runs: Vec::new(),
            });
        }
        let runs = &mut groups.last_mut().unwrap().runs;
        match runs.last_mut() {
            Some([first, count]) if u64::from(*first) + u64::from(*count) == u64::from(number) => {
                *count += 1
            }
            _ => runs.push([number, 1]),
        }
    }
    groups
}

fn expand<T>(base: T, first: u32, count: u32) -> Option<impl Iterator<Item = (T, u32)> + Clone>
where
    T: Clone,
{
    let last = first.checked_add(count.checked_sub(1)?)?;
    Some((first..=last).map(move |number| (base.clone(), number)))
}

pub(super) fn expand_ids(groups: &[Ids]) -> Option<Vec<(&str, u32)>> {
    let mut out = Vec::new();
    let mut previous = None;
    for Ids { base, runs } in groups {
        if runs.is_empty() || previous.is_some_and(|previous| previous >= base) {
            return None;
        }
        previous = Some(base);
        let mut end = None;
        for &[first, count] in runs {
            if end.is_some_and(|end| u64::from(first) <= end)
                || out.len().checked_add(count as usize)? > super::MOST_LINES
            {
                return None;
            }
            out.extend(expand(base.as_str(), first, count)?);
            end = Some(u64::from(first) + u64::from(count));
        }
    }
    Some(out)
}

pub(super) fn columns_written(axis: &Axis, bases: &Bases) -> Vec<Run> {
    axis.all()
        .chunk_by(|before, after| axis.is_deleted(*before) == axis.is_deleted(*after))
        .flat_map(|group| {
            let is_deleted = axis.is_deleted(group[0]);
            runs_of(group, bases)
                .into_iter()
                .map(move |ids| Run { ids, is_deleted })
        })
        .collect()
}

pub(super) fn read_runs(runs: &[Run], bases: &mut Bases) -> Option<Axis> {
    let mut all = Vec::new();
    let mut deleted = HashSet::new();
    for Run { ids, is_deleted } in runs {
        if all.len().checked_add(ids.count as usize)? > super::MOST_LINES {
            return None;
        }
        let base = bases.intern(&ids.base);
        let ids = expand(base, ids.first, ids.count)?.map(|(base, n)| LineId { base, n });
        if *is_deleted {
            deleted.extend(ids.clone());
        }
        all.extend(ids);
    }
    Axis::from_snapshot(all, deleted)
}

fn width(length: usize) -> usize {
    (usize::BITS - length.saturating_sub(1).leading_zeros())
        .div_ceil(6)
        .max(1) as usize
}

fn digit_string(number: usize, width: usize, out: &mut String) {
    for shift in (0..width).rev() {
        out.push(DIGITS[(number >> (shift * 6)) & 63] as char);
    }
}

pub(super) fn rows_written(axis: &Axis, bases: &Bases) -> Rows {
    if axis.all().is_empty() {
        return Rows::RunByRun(Vec::new());
    }
    let mut ids: Vec<_> = axis
        .all()
        .iter()
        .map(|id| (bases.name(id.base), id.n))
        .collect();
    ids.sort_unstable();
    let position: HashMap<_, _> = ids
        .iter()
        .copied()
        .enumerate()
        .map(|(idx, id)| (id, idx))
        .collect();
    let positions: Vec<_> = axis
        .all()
        .iter()
        .map(|id| position[&(bases.name(id.base), id.n)])
        .collect();
    let mut order = String::new();
    let width = width(ids.len());
    for run in positions.chunk_by(|&left, &right| right == left + 1) {
        digit_string(run[0], width, &mut order);
        if run.len() > 1 {
            order.push('+');
            digit_string(run.len() - 1, width, &mut order);
        }
    }
    let mut deleted: Vec<_> = axis
        .deleted()
        .map(|id| (bases.name(id.base), id.n))
        .collect();
    deleted.sort_unstable();
    Rows::InOrder(Order {
        all: OrderedIds {
            ids: grouped_ids(&ids),
            order,
        },
        deleted: grouped_ids(&deleted),
    })
}

impl Rows {
    pub(super) fn read(self, bases: &mut Bases) -> Option<Axis> {
        let order = match self {
            Rows::RunByRun(runs) => return read_runs(&runs, bases),
            Rows::InOrder(order) => order,
        };
        let to_line = |bases: &mut Bases, (base, n)| LineId {
            base: bases.intern(base),
            n,
        };
        let sorted: Vec<_> = expand_ids(&order.all.ids)?
            .into_iter()
            .map(|id| to_line(bases, id))
            .collect();
        let deleted = expand_ids(&order.deleted)?
            .into_iter()
            .map(|id| to_line(bases, id))
            .collect();
        let mut encoded = order.all.order.as_bytes();
        let width = width(sorted.len());
        let take_number = |encoded: &mut &[u8]| {
            let (number, suffix) = encoded.split_at_checked(width)?;
            *encoded = suffix;
            number.iter().try_fold(0usize, |v, &ch| {
                Some(v * 64 + DIGITS.iter().position(|&d| d == ch)?)
            })
        };
        let mut all = Vec::with_capacity(sorted.len());
        while !encoded.is_empty() {
            let first = take_number(&mut encoded)?;
            let last = if let Some(rest) = encoded.strip_prefix(b"+") {
                encoded = rest;
                first + take_number(&mut encoded)?
            } else {
                first
            };
            let run = sorted.get(first..=last)?;
            if all.len() + run.len() > sorted.len() {
                return None;
            }
            all.extend_from_slice(run);
        }
        if all.len() != sorted.len() {
            return None;
        }
        Axis::from_snapshot(all, deleted)
    }
}
