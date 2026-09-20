#property copyright "Trade Tracker"
#property version   "1.00"
#property description "Writes closed positions to Common/Files/trade-tracker.json"

input int    InpLookbackDays = 180;
input int    InpRefreshSec   = 5;
input string InpFileName     = "trade-tracker.json";

string JsonEscape(string value)
  {
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   return value;
  }

string JsonString(string value)
  {
   return "\"" + JsonEscape(value) + "\"";
  }

bool IsTradeDeal(const long type)
  {
   return(type == DEAL_TYPE_BUY || type == DEAL_TYPE_SELL);
  }

string PositionTypeName(const long deal_type)
  {
   return(deal_type == DEAL_TYPE_SELL ? "sell" : "buy");
  }

bool BuildClosedPosition(const ulong position_id, string &json)
  {
   if(!HistorySelectByPosition(position_id))
      return false;
   if(PositionSelectByTicket(position_id))
      return false;

   string   symbol = "";
   string   side = "";
   datetime open_time = 0;
   datetime close_time = 0;
   double   vol_in = 0.0;
   double   vol_out = 0.0;
   double   open_px_vol = 0.0;
   double   close_px_vol = 0.0;
   double   commission = 0.0;
   double   swap = 0.0;
   double   profit = 0.0;
   double   sl = 0.0;
   double   tp = 0.0;
   bool     has_out = false;

   const int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
     {
      const ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0)
         continue;
      const long type = HistoryDealGetInteger(ticket, DEAL_TYPE);
      if(!IsTradeDeal(type))
         continue;

      const long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      const double volume = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      const double price = HistoryDealGetDouble(ticket, DEAL_PRICE);
      const datetime time = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      commission += HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      swap += HistoryDealGetDouble(ticket, DEAL_SWAP);
      profit += HistoryDealGetDouble(ticket, DEAL_PROFIT);

      if(symbol == "")
         symbol = HistoryDealGetString(ticket, DEAL_SYMBOL);

      if(entry == DEAL_ENTRY_IN || entry == DEAL_ENTRY_INOUT)
        {
         if(side == "")
            side = PositionTypeName(type);
         vol_in += volume;
         open_px_vol += price * volume;
         if(open_time == 0 || time < open_time)
            open_time = time;
        }
      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_INOUT || entry == DEAL_ENTRY_OUT_BY)
        {
         has_out = true;
         vol_out += volume;
         close_px_vol += price * volume;
         if(time > close_time)
            close_time = time;
         sl = HistoryDealGetDouble(ticket, DEAL_SL);
         tp = HistoryDealGetDouble(ticket, DEAL_TP);
        }
     }

   if(!has_out || vol_out <= 0.0 || close_time == 0)
      return false;

   const double open_price = vol_in > 0.0 ? open_px_vol / vol_in : 0.0;
   const double close_price = close_px_vol / vol_out;
   const double net = profit + commission + swap;

   json = "{";
   json += "\"openTime\":" + JsonString(TimeToString(open_time, TIME_DATE | TIME_SECONDS)) + ",";
   json += "\"closeTime\":" + JsonString(TimeToString(close_time, TIME_DATE | TIME_SECONDS)) + ",";
   json += "\"ticket\":" + JsonString(IntegerToString(position_id)) + ",";
   json += "\"symbol\":" + JsonString(symbol) + ",";
   json += "\"type\":" + JsonString(side) + ",";
   json += "\"volume\":" + DoubleToString(vol_out, 2) + ",";
   json += "\"openPrice\":" + DoubleToString(open_price, 5) + ",";
   json += "\"sl\":" + DoubleToString(sl, 5) + ",";
   json += "\"tp\":" + DoubleToString(tp, 5) + ",";
   json += "\"closePrice\":" + DoubleToString(close_price, 5) + ",";
   json += "\"commission\":" + DoubleToString(commission, 2) + ",";
   json += "\"swap\":" + DoubleToString(swap, 2) + ",";
   json += "\"profit\":" + DoubleToString(profit, 2) + ",";
   json += "\"net\":" + DoubleToString(net, 2);
   json += "}";
   return true;
  }

void CollectPositionIds(ulong &ids[])
  {
   ArrayResize(ids, 0);
   const int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
     {
      const ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0)
         continue;
      if(!IsTradeDeal(HistoryDealGetInteger(ticket, DEAL_TYPE)))
         continue;
      const ulong position_id = (ulong)HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
      if(position_id == 0)
         continue;
      bool found = false;
      for(int j = 0; j < ArraySize(ids); j++)
        {
         if(ids[j] == position_id)
           {
            found = true;
            break;
           }
        }
      if(!found)
        {
         const int n = ArraySize(ids);
         ArrayResize(ids, n + 1);
         ids[n] = position_id;
        }
     }
  }

void ExportClosedTrades()
  {
   datetime from_time = TimeCurrent() - (datetime)InpLookbackDays * 24 * 60 * 60;
   if(from_time < 0)
      from_time = 0;
   if(!HistorySelect(from_time, TimeCurrent()))
     {
      Print("Trade Tracker: HistorySelect failed");
      return;
     }

   ulong ids[];
   CollectPositionIds(ids);

   string body = "";
   int count = 0;
   for(int i = 0; i < ArraySize(ids); i++)
     {
      string row;
      if(!BuildClosedPosition(ids[i], row))
         continue;
      if(count > 0)
         body += ",";
      body += row;
      count++;
     }

   const int handle = FileOpen(InpFileName, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON | FILE_SHARE_READ);
   if(handle == INVALID_HANDLE)
     {
      Print("Trade Tracker: cannot write ", InpFileName, " error ", GetLastError());
      return;
     }

   string json = "{\"currency\":\"USD\",\"source\":\"MT5 auto-export\",\"trades\":[";
   json += body;
   json += "]}";
   FileWriteString(handle, json);
   FileClose(handle);
  }

int OnInit()
  {
   EventSetTimer(MathMax(InpRefreshSec, 2));
   ExportClosedTrades();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
  }

void OnTimer()
  {
   ExportClosedTrades();
  }

void OnTrade()
  {
   ExportClosedTrades();
  }
