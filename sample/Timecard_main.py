# -*- coding: utf-8 -*-
"""
Created on Mon Oct  3 18:18:10 2022

@author: oushihaku
"""

## Timecard

import os
import sys
import csv
import sqlite3
from datetime import datetime, date, timedelta
import tkinter as tk
import tkinter.ttk as ttk
from tkinter import messagebox
import tempfile

def get_proj():
    
    proj_jyo_list = get_csv_n(pref_path + "/proj_jyo.csv")
    
    ##print("get_proj")
    ##print(proj_path)
    
    proj_list = os.listdir(proj_path)
    proj_list2 = []
    for i in proj_list:
        proj_path2 = proj_path + "/" + i
        if os.path.isdir(proj_path2) == True:
            if i not in proj_jyo_list:
                proj_list2.append(i)    
    ##print("\r\n")
    ##print(proj_list2)
    return proj_list2
    

def get_csv_n(csv_path):
    
    ##print("get_csv_n")
    with open(csv_path,"r") as f:
        csv_n = csv.reader(f)
        l = [row for row in csv_n]
        ##print("csv_n \r\n" + str(l[0]))
    return l[0]


def submit(name_combo,proj_combo,dpt_combo,progress_combo,memo_textbox,var,ltext):
    print("\r\nsubmit\r\n")
    now_time_s = datetime.strptime(ltext.get(),"%Y/%m/%d   %H:%M:%S")  
    print(now_time_s)
    date_s = datetime.strftime(now_time_s,'%Y/%m/%d')
    time_s = datetime.strftime(now_time_s,'%H:%M:%S')
    hours_s = int(datetime.strftime(now_time_s,'%H'))
    year_s = datetime.strftime(now_time_s,'%Y')
    if hours_s <= 6:
        date_s = datetime.strftime(now_time_s- timedelta(days=1),'%Y/%m/%d')
        year_s = datetime.strftime(now_time_s- timedelta(days=1),'%Y')
    name_s = name_combo.get()
    """
    proj_s = proj_combo.get()
    dpt_s = dpt_combo.get()
    progress_s = progress_combo.get()
    """
    memo_s = memo_textbox.get('1.0', 'end -1c')

    """
    print(name_s)
    print(proj_s)
    print(dpt_s)
    print(progress_s)
    print(" ")
    print(memo_s)
    print(" ")
    print(inout)  
    print(now_time_s)
    print(date_s)
    print(time_s)   
    print(year_s)
    """
    try:
        create_table(year_s)
        print("Table Created")
    except:
        print("Table Aready")
    ## in out hantei----------------------------------------------
            
    if var.get() == True:
        proj_text = ""
        for i in range(proj_count):
            
    
            proj_s = all_s_list[0][i].get()
            dpt_s = all_s_list[1][i].get()
            progress_s = all_s_list[2][i].get()
            ## OUT
            same_b = search_data(year_s,name_s,date_s,proj_s,dpt_s)
            
            if same_b == 1:
                upd_data(name_s,progress_s,date_s,time_s,year_s,memo_s,proj_s,dpt_s)
                proj_text = proj_text + "\r\nProj : " + proj_s +  " , DPT : " + dpt_s + " , Progress : " + progress_s

            else:
                messagebox.showwarning("ERROR", proj_s + "---" + dpt_s + "\r\n今日まだ出勤していない\r\n今天还没有提交上班")
                return
        send_mail(name_s,proj_s,dpt_s,progress_s,date_s,time_s,year_s,memo_s,"OUT",proj_text)
        messagebox.showinfo("FINISH", "退勤しました")                    
    else:
        proj_text = ""
        for i in range(proj_count):
            
    
            proj_s = all_s_list[0][i].get()
            dpt_s = all_s_list[1][i].get()
            progress_s = all_s_list[2][i].get()
            ## IN
            same_b = search_data(year_s,name_s,date_s,proj_s,dpt_s)
            
            if same_b == 0:
                sub_data(name_s,proj_s,dpt_s,progress_s,date_s,time_s,year_s,memo_s)
                proj_text = proj_text + "\r\nProj : " + proj_s +  " , DPT : " + dpt_s + " , Progress : " + progress_s


                
            else:
                ret = messagebox.askokcancel("ERROR", proj_s + "---" + dpt_s + "\r\n今日出勤済み　二個目を提出しますか\r\n今天已经提交了上班 是否提交第二个")
                if ret == True:
                    return
                    """
                    sub_data(name_s,proj_s,dpt_s,progress_s,date_s,time_s,year_s,memo_s)
                    proj_text = proj_text + "\r\nProj : " + proj_s +  " , DPT : " + dpt_s + " , Progress : " + progress_s
                    """


                else:
                    return
        send_mail(name_s,proj_s,dpt_s,progress_s,date_s,time_s,year_s,memo_s,"IN",proj_text)
        make_tmp_text(name_s,all_s_list[0][0].get(),all_s_list[1][0].get(),all_s_list[2][0].get())                    
        messagebox.showinfo("FINISH", "出勤しました")
def add_proj():
    print("add_proj")
    global proj_count
    
    if proj_count >= 4:
        messagebox.showwarning("ERROR","proj limit over")
    else:        
        proj_count +=1
        
        proj_combo2 = ttk.Combobox(root, justify="center",state="readonly",values = proj_list,width = 8)
        dpt_combo2 = ttk.Combobox(root, justify="center",state="readonly",values = dpt_list,width = 12)
        progress_combo2 = ttk.Combobox(root, justify="center",state="readonly",values = progress_list,width = 5)
       
        add_proj_main(proj_count,proj_combo2,dpt_combo2,progress_combo2)
    
    ##print(proj_count)


def add_proj_main(proj_count,proj_combo2,dpt_combo2,progress_combo2):
        
    proj_combo2.place(relx=0.05, rely=0.07*proj_count + 0.2)   
    
    
    dpt_combo2.place(relx=0.35, rely=0.07*proj_count + 0.2)     

    
    progress_combo2.place(relx=0.75, rely=0.07*proj_count + 0.2)   
    
    all_s_list[0].append(proj_combo2)
    all_s_list[1].append(dpt_combo2)
    all_s_list[2].append(progress_combo2)
    ##print(all_s_list)


def create_table(year_s): 
    
    conn = sqlite3.connect(dbname)
    cur = conn.cursor()
    ## create table
    try:
        cur.execute('CREATE TABLE Y_' + year_s + '(NAME STRING,DATE STING,IN_TIME STING,OUT_TIME STING,PROJ STING,DPT STING,PROGRESS_IN STING,PROGRESS_OUT STING,MEMO_IN STING,MEMO_OUT STING)')
    except:
        pass


def search_data(year_s,name_s,date_s,proj_s,dpt_s):
    print("search_data")
    search_k = []
    conn = sqlite3.connect(dbname)
    cur = conn.cursor()
    
    cur.execute('SELECT * FROM Y_' + year_s + ' WHERE NAME = "' + name_s + '" AND DATE = "' + date_s + '" AND PROJ = "' + proj_s + '" AND DPT = "' + dpt_s + '"')
    for row in cur:
        ##print(row)
        search_k.append(row)
    ##print(search_k) 
    ##print(len(search_k))
    if len(search_k) == 0:
        return 0
    else:
        return 1


def sub_data(name_s,proj_s,dpt_s,progress_s,date_s,time_s,year_s,memo_s):    
    ## insert data
    conn = sqlite3.connect(dbname)
    cur = conn.cursor()
        
    cur.execute('INSERT INTO Y_' + year_s + ' values("' + name_s + '","' + date_s + '","' + time_s + '"," ","' + proj_s + '","' + dpt_s + '","' + progress_s + '"," ","' + memo_s + '"," ")')
    
    conn.commit()
    
    conn.close()

def upd_data(name_s,progress_s,date_s,time_s,year_s,memo_s,proj_s,dpt_s):    
    ## insert data
    conn = sqlite3.connect(dbname)
    cur = conn.cursor()
        
    cur.execute('UPDATE Y_' + year_s + ' SET OUT_TIME="' + time_s + '",MEMO_OUT="' + memo_s + '",PROGRESS_OUT="' + progress_s + '" WHERE NAME = "' + name_s + '" AND DATE = "' + date_s + '" AND PROJ = "' + proj_s + '" AND DPT = "' + dpt_s + '"')
    
    conn.commit()
    
    conn.close()

def make_tmp_text(name_s,proj_s,dpt_s,progress_s):
    print("make_tmp_text")
    tmp_text_main ="Name," + name_s + ",Proj," + proj_s + ",DPT," + dpt_s + ",Progress," + progress_s 
    with open(timecard_path,"w") as f:
        f.write(tmp_text_main)
        
        
        




def send_mail(name_s,proj_s,dpt_s,progress_s,date_s,time_s,year_s,memo_s,in_out,proj_text):
    print("send_mail")
    import smtplib
    from email.mime.text import MIMEText
    if in_out == "IN":        
        mail_title = "始業報告  " + name_s
        mail_main = name_s + "\r\n\r\n始業時間 : " +date_s + " " + time_s + "\r\n" + proj_text + "\r\n\r\nMemo==============================\r\n" + memo_s + "\r\n=================================="
    elif in_out == "OUT":
        mail_title = "終業報告  " + name_s
        mail_main = name_s + "\r\n\r\n終業時間 : " +date_s + " " + time_s + "\r\n" + proj_text + "\r\n\r\nMemo==============================\r\n" + memo_s + "\r\n=================================="
    
    # 送受信先

    
    msg = MIMEText(mail_main, "plain", 'utf-8')
    msg['Subject'] = mail_title
    msg['From'] = from_addr
    msg['To'] = to_addr
    
    with smtplib.SMTP_SSL(host="smtp.studiobokan.com", port=465) as smtp:
        smtp.login('kintai@studiobokan.com', 'JZlOnO&5')
        smtp.send_message(msg)
        smtp.quit()



def chk_time(root, ltext):
    now = datetime.now()
    stime = "{0:%Y/%m/%d   %H:%M:%S}".format(now)
    ltext.set(stime)

    root.after(5, lambda : chk_time(root, ltext))

def main(timecard_tmp_b):
    

    
    root.title("TimeCard")
    root.geometry("280x500")
    root.resizable(False,False)
    


    ltext = tk.StringVar()
    time_label = tk.Label(root,textvariable=ltext)
    time_label.place(relx=0.45, rely=0.02)
    
    name_label = tk.Label(root,text = "Name")
    name_label.place(relx=0.08, rely=0.09)
    
    name_combo = ttk.Combobox(root, justify="center",state="readonly",values = name_list)
    name_combo.place(relx=0.3, rely=0.09)
    

    loadimage = tk.PhotoImage(file="//192.168.44.24/cache2/cg/tools/Rendezvous/tools/button_test.png")
    roundedbutton = tk.Button(root, image=loadimage,command = add_proj)
    roundedbutton.place(relx=0.04, rely=0.15)  

    
    proj_label = tk.Label(root,text = "Proj")
    proj_label.place(relx=0.13, rely=0.20)  
    
    proj_combo = ttk.Combobox(root, justify="center",state="readonly",values = proj_list,width = 8)
    proj_combo.place(relx=0.05, rely=0.27)
    
    dpt_label = tk.Label(root,text = "DPT")
    dpt_label.place(relx=0.47, rely=0.20)  
    
    dpt_combo = ttk.Combobox(root, justify="center",state="readonly",values = dpt_list,width = 12)
    dpt_combo.place(relx=0.35, rely=0.27)   
    
    progress_label = tk.Label(root,text = "Progress")
    progress_label.place(relx=0.75, rely=0.20)  
    
    progress_combo = ttk.Combobox(root, justify="center",state="readonly",values = progress_list,width = 5)
    progress_combo.place(relx=0.75, rely=0.27)   
    
    memo_label = tk.Label(root,text = "Memo")
    memo_label.place(relx=0.08, rely=0.58)    

    memo_textbox = tk.Text(width=34,height = 10)
    memo_textbox.place(relx=0.08, rely=0.63)   
    
    
    var = tk.IntVar()
    var.set(0)
    
    inraio = tk.Radiobutton(root,value=0, variable=var,text='In')
    outraio = tk.Radiobutton(root,value=1, variable=var,text='out')
    inraio.place(relx=0.10, rely=0.92)    
    outraio.place(relx=0.30, rely=0.92)    
    
    
    all_s_list[0].append(proj_combo)
    all_s_list[1].append(dpt_combo)
    all_s_list[2].append(progress_combo)
    

    
    sub_button = ttk.Button(root, text='Submit', command=lambda : submit(name_combo,proj_combo,dpt_combo,progress_combo,memo_textbox,var,ltext))
    sub_button.place(relx=0.62, rely=0.92)   
    

    if timecard_tmp_b == 1:
        with open(timecard_path,"r") as f:
            tmp_n = str(f.read())
        tmp_list = tmp_n.split(",")       
        print("\r\ntmp_list")
        print(tmp_list)  
        
        name_combo.set(tmp_list[1])
        proj_combo.set(tmp_list[3])
        dpt_combo.set(tmp_list[5])
        progress_combo.set(tmp_list[7])
    
    
    
    root.after(5, lambda : chk_time(root, ltext))
    root.mainloop()

root = tk.Tk()
all_s_list = [[] for i in range(3)]
to_addr = "kintai@mail.studiobokan.com"
from_addr = "kintai@studiobokan.com"
dbname = "//192.168.44.24/cache2/cg/tools/Rendezvous/tools/Timecard_DB/timecard.db"
pref_path = "//192.168.44.24/cache2/cg/tools/Rendezvous/tools/Timecard_pref"

proj_path = "//192.168.44.15/bokanserver_1/cg/proj"
temp_path = os.environ["TEMP"]
timecard_path = temp_path + "/bokan_timecard_tmp.txt"
if os.path.isfile(timecard_path) == True:
    timecard_tmp_b = 1    
else:
    timecard_tmp_b = 0
print("timecard tmp Boolean \r\n" + str(timecard_tmp_b))

proj_list = get_proj()
name_list = get_csv_n(pref_path + "/users.csv")
print("name_list")
print(name_list)
dpt_list = get_csv_n(pref_path + "/dpt.csv")
print("dpt_list")
print(dpt_list)

proj_count = 1


progress_list = []
for i in range(101):
    progress_list.append(str(i) + "%")






main(timecard_tmp_b)
