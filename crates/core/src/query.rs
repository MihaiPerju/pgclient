use std::time::Instant;

use futures_util::{StreamExt, pin_mut};
use serde::Serialize;
use tokio::sync::mpsc::Sender;
use tokio_postgres::{Client, SimpleQueryMessage};

use crate::error::describe;

/// Big enough to keep the number of messages down, small enough that the first rows show at once.
const ROWS_PER_CHUNK: usize = 1000;

type Row = Vec<Option<String>>;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum QueryEvent {
    ResultStarted { columns: Vec<String> },
    Rows { rows: Vec<Row> },
    ResultFinished { rows_affected: u64 },
    Failed { message: String },
    Finished { elapsed_ms: u64 },
}

struct Outbox {
    events: Sender<QueryEvent>,
    pending: Vec<Row>,
}

impl Outbox {
    async fn send(&self, event: QueryEvent) -> bool {
        self.events.send(event).await.is_ok()
    }

    async fn flush(&mut self) -> bool {
        if self.pending.is_empty() {
            return true;
        }
        let rows = std::mem::take(&mut self.pending);
        self.send(QueryEvent::Rows { rows }).await
    }
}

/// Runs every statement in `sql` and reports each result as it arrives. Stops quietly if nobody is listening any more.
pub(crate) async fn stream(client: Client, sql: String, events: Sender<QueryEvent>) {
    let started = Instant::now();
    let mut outbox = Outbox {
        events,
        pending: Vec::new(),
    };
    let messages = match client.simple_query_raw(&sql).await {
        Ok(messages) => messages,
        Err(error) => {
            outbox
                .send(QueryEvent::Failed {
                    message: describe(&error),
                })
                .await;
            return;
        }
    };
    pin_mut!(messages);

    while let Some(message) = messages.next().await {
        let alive = match message {
            Ok(SimpleQueryMessage::RowDescription(columns)) => {
                let names = columns
                    .iter()
                    .map(|column| column.name().to_string())
                    .collect();
                outbox.flush().await
                    && outbox
                        .send(QueryEvent::ResultStarted { columns: names })
                        .await
            }
            Ok(SimpleQueryMessage::Row(row)) => {
                outbox.pending.push(
                    (0..row.len())
                        .map(|i| row.get(i).map(str::to_owned))
                        .collect(),
                );
                outbox.pending.len() < ROWS_PER_CHUNK || outbox.flush().await
            }
            Ok(SimpleQueryMessage::CommandComplete(rows_affected)) => {
                outbox.flush().await
                    && outbox
                        .send(QueryEvent::ResultFinished { rows_affected })
                        .await
            }
            Ok(_) => true,
            Err(error) => {
                outbox.flush().await;
                outbox
                    .send(QueryEvent::Failed {
                        message: describe(&error),
                    })
                    .await;
                return;
            }
        };
        if !alive {
            return;
        }
    }
    outbox.flush().await;
    let elapsed_ms = started.elapsed().as_millis() as u64;
    outbox.send(QueryEvent::Finished { elapsed_ms }).await;
}
