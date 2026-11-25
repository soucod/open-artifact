//! The people a cell names: one entered (`enter` with a `user` entry), one added to those a cell names
//! (`addUserToCell`), one taken away (`removeUserFromCell`).
//!
//! A person comes with their id (`u_` and 22 letters, digits or `_`, else `userIdNotWellFormed`) and a name, which
//! the cell keeps as their label: without control characters, without spaces around it, at most 200 characters
//! (nothing left: `userLabelNotAllowed`).
//!
//! A person added to a cell that names nobody makes it name them, whatever it held; added to a cell that names
//! someone, the cell names both, up to 40 people (`tooManyUsersInCell`). A person the cell names already keeps their
//! place with the label given. Taken away, the cell names the rest; a cell left naming nobody is emptied.

use serde::Deserialize;
use serde_json::Value;

use super::{cell_of, CellAt};
use crate::workbook::grid::CellForm;
use crate::workbook::load::{CellToSet, Op, Refusal};
use crate::workbook::rich::{self, Person};
use crate::workbook::{Input, Workbook};

/// The most characters of a label a cell keeps.
const LONGEST_LABEL: usize = 200;
/// The most people a cell names.
const MOST_USERS_IN_CELL: usize = 40;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum PeopleEdit {
    #[serde(rename_all = "camelCase")]
    AddUserToCell { sheet_id: String, cell: CellAt, user_id: String, name: String },
    #[serde(rename_all = "camelCase")]
    RemoveUserFromCell { sheet_id: String, cell: CellAt, user_id: String },
}

/// Whether an `addUserToCell` or `removeUserFromCell` edit reads.
pub fn reads(edit: &Value) -> bool {
    PeopleEdit::deserialize(edit).is_ok()
}

/// A person as a cell names them, from their id and name, or why they can't be.
pub(super) fn person(user_id: &str, name: &str) -> Result<Input, Refusal> {
    let Person { user_id, label } = person_named(user_id, name)?;
    Ok(Input::User { user_id, label })
}

fn person_named(user_id: &str, name: &str) -> Result<Person, Refusal> {
    if !rich::is_user_id(user_id) {
        return Err(Refusal::UserIdNotWellFormed);
    }
    let label: String = name.chars().filter(|c| !c.is_control()).collect();
    let label: String = label.trim().chars().take(LONGEST_LABEL).collect();
    if label.is_empty() {
        return Err(Refusal::UserLabelNotAllowed);
    }
    Ok(Person { user_id: user_id.to_owned(), label })
}

/// Whether a person is as a cell keeps them: their id well formed, their label the one their name would give.
pub fn is_kept_person(person: &Person) -> bool {
    person_named(&person.user_id, &person.label).is_ok_and(|kept| kept.label == person.label)
}

/// Whether people are as a cell keeps them: two to 40 of them, none twice, each kept.
pub fn are_kept_people(people: &[Person]) -> bool {
    rich::are_people(people) && people.len() <= MOST_USERS_IN_CELL && people.iter().all(is_kept_person)
}

/// The people a cell's input names.
fn people_of(input: Option<&Input>) -> Vec<Person> {
    match input {
        Some(Input::User { user_id, label }) => vec![Person { user_id: user_id.clone(), label: label.clone() }],
        Some(Input::Users { users }) => users.clone(),
        _ => Vec::new(),
    }
}

/// The input naming people (`None`: nobody).
fn input_of(mut people: Vec<Person>) -> Option<Input> {
    match people.len() {
        0 => None,
        1 => {
            let Person { user_id, label } = people.remove(0);
            Some(Input::User { user_id, label })
        }
        _ => Some(Input::Users { users: people }),
    }
}

/// The operations of an `addUserToCell` or `removeUserFromCell` edit, or the refusal.
pub fn change_people(workbook: &Workbook, edit: &Value) -> Result<Vec<Op>, Refusal> {
    let edit = PeopleEdit::deserialize(edit).map_err(|_| Refusal::UnreadableRequest)?;
    let (PeopleEdit::AddUserToCell { sheet_id, cell, .. } | PeopleEdit::RemoveUserFromCell { sheet_id, cell, .. }) =
        &edit;
    let s = workbook.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
    let sheet = &workbook.sheets[s];
    let (place, covered) = cell_of(workbook, sheet, &cell.r, &cell.c)?;
    let now = sheet.cells.get(&place).map(|cell| &cell.input);
    let mut people = people_of(now);
    match &edit {
        PeopleEdit::AddUserToCell { user_id, name, .. } => {
            let person = person_named(user_id, name)?;
            match people.iter().position(|p| p.user_id == person.user_id) {
                Some(i) => people[i].label = person.label,
                None if people.len() >= MOST_USERS_IN_CELL => return Err(Refusal::TooManyUsersInCell),
                None => people.push(person),
            }
        }
        PeopleEdit::RemoveUserFromCell { user_id, .. } => {
            if !people.iter().any(|p| &p.user_id == user_id) {
                return Ok(Vec::new());
            }
            people.retain(|p| &p.user_id != user_id);
        }
    }
    let input = input_of(people);
    if input.as_ref() == now {
        return Ok(Vec::new());
    }
    if covered && input.is_some() {
        return Err(Refusal::CellCoveredByMergedRange);
    }
    let cells = vec![CellToSet { r: workbook.bases.text(place.0), c: workbook.bases.text(place.1), input }];
    Ok(vec![Op::SetCells { sheet_id: sheet.id.clone(), cells, form: CellForm::Auto }])
}
